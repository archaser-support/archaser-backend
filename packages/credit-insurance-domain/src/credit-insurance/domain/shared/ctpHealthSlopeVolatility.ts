/**
 * Health-index momentum (KPI #5), day-over-day AR volatility (KPI #6),
 * and shared peak/current framing. Stale/carried-forward days come from
 * {@link detectStaleArRuns} and are excluded from slope/volatility by default.
 */

import {
    areCalendarConsecutive,
    detectStaleArRuns,
    trailingLinearSlope,
    type CtpArDayPoint,
    type CtpValueDayPoint,
    type TrailingLinearSlopeResult,
} from "./ctpDailySeries";

/** Prompt default: suppress classification under ~10 available (non-stale) days. */
export const HEALTH_SLOPE_MIN_DAYS = 10;

/** Improving when slope > +0.1 health points per calendar day. */
export const HEALTH_SLOPE_IMPROVING_THRESHOLD = 0.1;

/** Deteriorating when slope < −0.1 health points per calendar day. */
export const HEALTH_SLOPE_DETERIORATING_THRESHOLD = -0.1;

/** Single-day AR swing beyond ±10% is flaggable separately from σ. */
export const AR_EXTREME_DOD_PCT_THRESHOLD = 0.1;

export type HealthMomentumClassification =
    | "improving"
    | "flat"
    | "deteriorating";

export type HealthMomentumResult = {
    slope: number | null;
    rSquared: number | null;
    daysUsed: number;
    /** True when too few non-excluded days remain for a stable slope. */
    suppressed: boolean;
    /** Null when suppressed. */
    classification: HealthMomentumClassification | null;
    peakHealth: number | null;
    peakDate: string | null;
    currentHealth: number | null;
    currentDate: string | null;
    slopeFit: TrailingLinearSlopeResult;
};

export type ArDodChangePoint = {
    snapshotDate: string;
    /** Prior available day used for the pair (calendar-consecutive). */
    priorDate: string;
    /** (AR[t] − AR[t-1]) / AR[t-1]; never invented across gaps. */
    pctChange: number;
    extreme: boolean;
};

export type ArNewActivityEvent = {
    snapshotDate: string;
    priorDate: string;
    /** AR jumped from exactly 0 on the prior consecutive day. */
    ar: number;
};

export type ArVolatilityResult = {
    /** Sample stdev of DoD % changes; null when fewer than 2 eligible pairs. */
    sigmaPct: number | null;
    pairCount: number;
    minPctChange: number | null;
    minPctChangeDate: string | null;
    maxPctChange: number | null;
    maxPctChangeDate: string | null;
    dailyPctChanges: ArDodChangePoint[];
    extremeMoves: ArDodChangePoint[];
    newActivityEvents: ArNewActivityEvent[];
    staleDayCount: number;
    staleDates: string[];
};

export type HealthMomentumOptions = {
    minDays?: number;
    /** Default true — exclude carried-forward identical non-zero AR days. */
    excludeStale?: boolean;
    /** Optional AR series for stale detection; falls back to no exclude. */
    arPoints?: CtpArDayPoint[];
    /** Precomputed stale exclude set (wins over arPoints when both set). */
    excludeDates?: ReadonlySet<string>;
    trailingDays?: number;
    improvingThreshold?: number;
    deterioratingThreshold?: number;
};

export type ArVolatilityOptions = {
    /** Default true — exclude stale days from DoD pairs. */
    excludeStale?: boolean;
    excludeDates?: ReadonlySet<string>;
    extremeThreshold?: number;
};

function sortByDate<T extends { snapshotDate: string }>(points: T[]): T[] {
    return [...points].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate)
    );
}

export function classifyHealthSlope(
    slope: number | null,
    suppressed: boolean,
    options?: {
        improvingThreshold?: number;
        deterioratingThreshold?: number;
    }
): HealthMomentumClassification | null {
    if (suppressed || slope == null || !Number.isFinite(slope)) {
        return null;
    }
    const improving =
        options?.improvingThreshold ?? HEALTH_SLOPE_IMPROVING_THRESHOLD;
    const deteriorating =
        options?.deterioratingThreshold ?? HEALTH_SLOPE_DETERIORATING_THRESHOLD;
    if (slope > improving) {
        return "improving";
    }
    if (slope < deteriorating) {
        return "deteriorating";
    }
    return "flat";
}

/**
 * Peak (max health + earliest date on ties) and current (last available day)
 * over the full input series — not only the slope window — so non-monotonic
 * paths still show "peaked at X on {date}, now at Y".
 */
export function resolveHealthPeakAndCurrent(
    points: CtpValueDayPoint[]
): Pick<
    HealthMomentumResult,
    "peakHealth" | "peakDate" | "currentHealth" | "currentDate"
> {
    const sorted = sortByDate(
        points.filter((p) => Number.isFinite(p.value))
    );
    if (sorted.length === 0) {
        return {
            peakHealth: null,
            peakDate: null,
            currentHealth: null,
            currentDate: null,
        };
    }
    let peak = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
        const point = sorted[i];
        if (point.value > peak.value) {
            peak = point;
        }
    }
    const current = sorted[sorted.length - 1];
    return {
        peakHealth: peak.value,
        peakDate: peak.snapshotDate,
        currentHealth: current.value,
        currentDate: current.snapshotDate,
    };
}

function resolveStaleExcludeSet(
    options?: Pick<HealthMomentumOptions, "excludeStale" | "excludeDates" | "arPoints">
): Set<string> | undefined {
    const excludeStale = options?.excludeStale !== false;
    if (!excludeStale) {
        return undefined;
    }
    if (options?.excludeDates != null) {
        return new Set(options.excludeDates);
    }
    if (options?.arPoints != null && options.arPoints.length > 0) {
        return detectStaleArRuns(options.arPoints).excludeSet;
    }
    return undefined;
}

/**
 * Trailing linear health slope + momentum badge classification + peak/current.
 * Stale days excluded by default when AR points or an exclude set are provided.
 */
export function computeHealthMomentum(
    healthPoints: CtpValueDayPoint[],
    options?: HealthMomentumOptions
): HealthMomentumResult {
    const excludeDates = resolveStaleExcludeSet(options);
    const slopeFit = trailingLinearSlope(healthPoints, {
        minDays: options?.minDays ?? HEALTH_SLOPE_MIN_DAYS,
        excludeDates,
        trailingDays: options?.trailingDays,
    });
    const classification = classifyHealthSlope(
        slopeFit.slope,
        slopeFit.suppressed,
        {
            improvingThreshold: options?.improvingThreshold,
            deterioratingThreshold: options?.deterioratingThreshold,
        }
    );
    const peakCurrent = resolveHealthPeakAndCurrent(healthPoints);
    return {
        slope: slopeFit.slope,
        rSquared: slopeFit.rSquared,
        daysUsed: slopeFit.daysUsed,
        suppressed: slopeFit.suppressed,
        classification,
        ...peakCurrent,
        slopeFit,
    };
}

function sampleStdev(values: number[]): number | null {
    if (values.length < 2) {
        return null;
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    let ss = 0;
    for (const v of values) {
        ss += (v - mean) ** 2;
    }
    return Math.sqrt(ss / (values.length - 1));
}

/**
 * Day-over-day AR % volatility. Skips pairs across missing snapshot days,
 * skips/caps AR[t-1]=0 as new-activity (not a % change), and excludes stale
 * days from pair endpoints by default.
 */
export function computeArVolatility(
    arPoints: CtpArDayPoint[],
    options?: ArVolatilityOptions
): ArVolatilityResult {
    const sorted = sortByDate(
        arPoints.filter((p) => Number.isFinite(p.totalReceivables))
    );
    const stale = detectStaleArRuns(sorted);
    const excludeStale = options?.excludeStale !== false;
    const excludeDates =
        options?.excludeDates != null
            ? new Set(options.excludeDates)
            : excludeStale
              ? stale.excludeSet
              : new Set<string>();

    const dailyPctChanges: ArDodChangePoint[] = [];
    const newActivityEvents: ArNewActivityEvent[] = [];
    const extremeThreshold =
        options?.extremeThreshold ?? AR_EXTREME_DOD_PCT_THRESHOLD;

    for (let i = 1; i < sorted.length; i += 1) {
        const prev = sorted[i - 1];
        const curr = sorted[i];
        if (!areCalendarConsecutive(prev.snapshotDate, curr.snapshotDate)) {
            continue;
        }
        if (
            excludeDates.has(prev.snapshotDate) ||
            excludeDates.has(curr.snapshotDate)
        ) {
            continue;
        }
        const priorAr = prev.totalReceivables;
        const currAr = curr.totalReceivables;
        if (priorAr === 0) {
            if (currAr !== 0) {
                newActivityEvents.push({
                    snapshotDate: curr.snapshotDate,
                    priorDate: prev.snapshotDate,
                    ar: currAr,
                });
            }
            continue;
        }
        const pctChange = (currAr - priorAr) / priorAr;
        if (!Number.isFinite(pctChange)) {
            continue;
        }
        dailyPctChanges.push({
            snapshotDate: curr.snapshotDate,
            priorDate: prev.snapshotDate,
            pctChange,
            extreme: Math.abs(pctChange) >= extremeThreshold,
        });
    }

    const pctValues = dailyPctChanges.map((p) => p.pctChange);
    let minPctChange: number | null = null;
    let minPctChangeDate: string | null = null;
    let maxPctChange: number | null = null;
    let maxPctChangeDate: string | null = null;
    for (const point of dailyPctChanges) {
        if (minPctChange == null || point.pctChange < minPctChange) {
            minPctChange = point.pctChange;
            minPctChangeDate = point.snapshotDate;
        }
        if (maxPctChange == null || point.pctChange > maxPctChange) {
            maxPctChange = point.pctChange;
            maxPctChangeDate = point.snapshotDate;
        }
    }

    return {
        sigmaPct: sampleStdev(pctValues),
        pairCount: dailyPctChanges.length,
        minPctChange,
        minPctChangeDate,
        maxPctChange,
        maxPctChangeDate,
        dailyPctChanges,
        extremeMoves: dailyPctChanges.filter((p) => p.extreme),
        newActivityEvents,
        staleDayCount: stale.staleDayCount,
        staleDates: stale.staleDates,
    };
}

export type CustomerHealthSlopeVolatilityMetrics = {
    healthMomentum: HealthMomentumResult;
    arVolatility: ArVolatilityResult;
    staleDayCount: number;
    staleDates: string[];
};

/**
 * Combined customer metrics from parallel health + AR available-day series
 * (same snapshot dates preferred; AR drives stale detection for both).
 */
export function computeCustomerHealthSlopeVolatilityMetrics(input: {
    healthPoints: CtpValueDayPoint[];
    arPoints: CtpArDayPoint[];
    healthOptions?: Omit<HealthMomentumOptions, "arPoints" | "excludeDates">;
    volatilityOptions?: Omit<ArVolatilityOptions, "excludeDates">;
}): CustomerHealthSlopeVolatilityMetrics {
    const stale = detectStaleArRuns(input.arPoints);
    const healthMomentum = computeHealthMomentum(input.healthPoints, {
        ...input.healthOptions,
        excludeDates: stale.excludeSet,
        arPoints: input.arPoints,
    });
    const arVolatility = computeArVolatility(input.arPoints, {
        ...input.volatilityOptions,
        excludeDates: stale.excludeSet,
    });
    return {
        healthMomentum,
        arVolatility,
        staleDayCount: stale.staleDayCount,
        staleDates: stale.staleDates,
    };
}
