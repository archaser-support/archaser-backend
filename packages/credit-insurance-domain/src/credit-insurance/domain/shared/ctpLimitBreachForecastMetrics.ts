/**
 * Limit-breach forecast (KPI #10): trailing-window linear trend of usage %,
 * projecting crossings of default 150% / 200% only when trending toward the
 * threshold and R² is above a floor. Otherwise suppress or mark trending away.
 *
 * Reuses {@link trailingLinearSlope} from ctpDailySeries — do not reimplement OLS.
 */

import {
    addUtcDaysToYmd,
    trailingLinearSlope,
    type CtpValueDayPoint,
} from "./ctpDailySeries";

/** Prompt default: Credit dashboard forecast uses trailing 30 available days. */
export const LIMIT_BREACH_FORECAST_TRAILING_DAYS = 30;

/** Same floor as shared slope helper default. */
export const LIMIT_BREACH_FORECAST_MIN_DAYS = 7;

/** Suppress projection when fit quality is below this R². */
export const LIMIT_BREACH_FORECAST_R2_FLOOR = 0.5;

/** Default utilization % thresholds to project. */
export const LIMIT_BREACH_FORECAST_THRESHOLDS = [150, 200] as const;

/**
 * Cap horizon so we never ship false-precision far-future dates.
 * Projections beyond this many calendar days are suppressed.
 */
export const LIMIT_BREACH_FORECAST_MAX_HORIZON_DAYS = 365;

export type LimitBreachForecastStatus =
    | "projected"
    | "trending_away"
    | "already_above"
    | "suppressed"
    | "insufficient_data";

export type LimitBreachForecastOptions = {
    trailingDays?: number;
    minDays?: number;
    rSquaredFloor?: number;
    thresholds?: readonly number[];
    maxHorizonDays?: number;
};

export type LimitBreachThresholdForecast = {
    thresholdPct: number;
    status: LimitBreachForecastStatus;
    /** Only when status === "projected" (UTC YYYY-MM-DD, whole days). */
    projectedDate: string | null;
    /** Ceiling of calendar days to threshold; null when not projected. */
    daysToThreshold: number | null;
    currentUsagePct: number | null;
    slopePerDay: number | null;
    rSquared: number | null;
};

export type LimitBreachForecastResult = {
    daysUsed: number;
    suppressed: boolean;
    slope: number | null;
    rSquared: number | null;
    currentUsagePct: number | null;
    asOfDate: string | null;
    /**
     * Soonest projected threshold crossing (lowest daysToThreshold among
     * status === "projected"). Null when none project.
     */
    primary: LimitBreachThresholdForecast | null;
    thresholds: LimitBreachThresholdForecast[];
};

function sortByDate(points: CtpValueDayPoint[]): CtpValueDayPoint[] {
    return [...points].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate)
    );
}

function emptyResult(
    partial?: Partial<LimitBreachForecastResult>
): LimitBreachForecastResult {
    return {
        daysUsed: 0,
        suppressed: true,
        slope: null,
        rSquared: null,
        currentUsagePct: null,
        asOfDate: null,
        primary: null,
        thresholds: [],
        ...partial,
    };
}

/**
 * Project utilization % crossings from a trailing OLS fit.
 * Missing snapshot days are already absent from `points` (available-day convention).
 */
export function computeLimitBreachForecast(
    points: CtpValueDayPoint[],
    options?: LimitBreachForecastOptions
): LimitBreachForecastResult {
    const trailingDays =
        options?.trailingDays ?? LIMIT_BREACH_FORECAST_TRAILING_DAYS;
    const minDays = options?.minDays ?? LIMIT_BREACH_FORECAST_MIN_DAYS;
    const rSquaredFloor =
        options?.rSquaredFloor ?? LIMIT_BREACH_FORECAST_R2_FLOOR;
    const thresholds = [
        ...(options?.thresholds ?? LIMIT_BREACH_FORECAST_THRESHOLDS),
    ].sort((a, b) => a - b);
    const maxHorizonDays =
        options?.maxHorizonDays ?? LIMIT_BREACH_FORECAST_MAX_HORIZON_DAYS;

    const finite = sortByDate(points).filter((p) => Number.isFinite(p.value));
    if (finite.length === 0) {
        return emptyResult({
            thresholds: thresholds.map((thresholdPct) => ({
                thresholdPct,
                status: "insufficient_data" as const,
                projectedDate: null,
                daysToThreshold: null,
                currentUsagePct: null,
                slopePerDay: null,
                rSquared: null,
            })),
        });
    }

    const fit = trailingLinearSlope(finite, {
        minDays,
        trailingDays,
        includeRSquared: true,
    });

    const windowed =
        trailingDays > 0 && finite.length > trailingDays
            ? finite.slice(finite.length - trailingDays)
            : finite;
    const last = windowed[windowed.length - 1]!;
    const currentUsagePct = last.value;
    const asOfDate = last.snapshotDate;

    if (fit.suppressed || fit.slope == null) {
        return emptyResult({
            daysUsed: fit.daysUsed,
            suppressed: true,
            currentUsagePct,
            asOfDate,
            thresholds: thresholds.map((thresholdPct) => ({
                thresholdPct,
                status: "insufficient_data" as const,
                projectedDate: null,
                daysToThreshold: null,
                currentUsagePct,
                slopePerDay: null,
                rSquared: null,
            })),
        });
    }

    const slope = fit.slope;
    const rSquared = fit.rSquared;
    const fitQualityOk =
        rSquared != null && Number.isFinite(rSquared) && rSquared >= rSquaredFloor;

    const thresholdResults: LimitBreachThresholdForecast[] = thresholds.map(
        (thresholdPct) => {
            const base = {
                thresholdPct,
                currentUsagePct,
                slopePerDay: slope,
                rSquared,
            };

            if (currentUsagePct >= thresholdPct) {
                return {
                    ...base,
                    status: "already_above" as const,
                    projectedDate: null,
                    daysToThreshold: null,
                };
            }

            if (!fitQualityOk) {
                return {
                    ...base,
                    status: "suppressed" as const,
                    projectedDate: null,
                    daysToThreshold: null,
                };
            }

            // Trending toward threshold requires positive slope when below it.
            if (slope <= 0) {
                return {
                    ...base,
                    status: "trending_away" as const,
                    projectedDate: null,
                    daysToThreshold: null,
                };
            }

            const rawDays = (thresholdPct - currentUsagePct) / slope;
            if (!Number.isFinite(rawDays) || rawDays < 0) {
                return {
                    ...base,
                    status: "suppressed" as const,
                    projectedDate: null,
                    daysToThreshold: null,
                };
            }

            // Whole calendar days only — no sub-day false precision.
            const daysToThreshold = Math.max(1, Math.ceil(rawDays));
            if (daysToThreshold > maxHorizonDays) {
                return {
                    ...base,
                    status: "suppressed" as const,
                    projectedDate: null,
                    daysToThreshold: null,
                };
            }

            return {
                ...base,
                status: "projected" as const,
                projectedDate: addUtcDaysToYmd(asOfDate, daysToThreshold),
                daysToThreshold,
            };
        }
    );

    const projected = thresholdResults.filter((t) => t.status === "projected");
    let primary: LimitBreachThresholdForecast | null = null;
    for (const t of projected) {
        if (
            primary == null ||
            (t.daysToThreshold ?? Infinity) <
                (primary.daysToThreshold ?? Infinity)
        ) {
            primary = t;
        }
    }

    return {
        daysUsed: fit.daysUsed,
        suppressed: !fitQualityOk,
        slope,
        rSquared,
        currentUsagePct,
        asOfDate,
        primary,
        thresholds: thresholdResults,
    };
}

/** True when at least one threshold projects a crossing. */
export function hasProjectedLimitBreach(
    result: LimitBreachForecastResult
): boolean {
    return result.primary != null && result.primary.status === "projected";
}
