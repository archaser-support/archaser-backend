/**
 * Utilization overshoot magnitude (KPI #2) + limit-capped / compliant-exposure
 * ceiling detection (KPI #3) from CTP daily series.
 *
 * Overshoot floors at 0 on under-100% days. Null / no effective limit days are
 * excluded (never treated as 0% usage). Limit-capped uses CV + AR growth
 * thresholds and is suppressed on short available-day windows.
 */

import {
    analyzeBooleanDaySeries,
    type CtpSnapshotDay,
    type StreakWindow,
} from "./ctpDailySeries";

/** Prompt default: suppress limit-capped under ~14 available days. */
export const LIMIT_CAPPED_MIN_DAYS = 14;

/** Compliant exposure CV must stay below this (flat ceiling). */
export const LIMIT_CAPPED_COMPLIANT_CV_MAX = 0.05;

/** Total AR CV must exceed this (material movement). */
export const LIMIT_CAPPED_AR_CV_MIN = 0.2;

/** Total AR must grow by at least this fraction over the window. */
export const LIMIT_CAPPED_AR_GROWTH_MIN = 0.15;

export type CtpUtilizationDayPoint = CtpSnapshotDay & {
    /**
     * Effective (or policy) utilization % for the day.
     * Null when no positive effective limit (exclude from overshoot).
     */
    utilizationPct: number | null;
};

export type CtpLimitCappedDayPoint = CtpSnapshotDay & {
    totalReceivables: number;
    compliantExposure: number;
};

export type UtilizationOvershootMetrics = {
    daysAvailable: number;
    /** Days with a positive effective limit (included in overshoot mean). */
    daysWithLimit: number;
    /** Available days with utilization strictly above 100%. */
    daysAboveLimit: number;
    /** Longest consecutive available-day streak above 100% utilization. */
    longestAboveLimitStreak: StreakWindow;
    /** Mean of max(0, util − 100); null when no limit days. */
    avgOvershootPts: number | null;
    /** Max of max(0, util − 100); null when no limit days. */
    maxOvershootPts: number | null;
    maxOvershootDate: string | null;
    /** Mean utilization % over limit days; null when none. */
    avgUsagePct: number | null;
    /** Peak utilization % over limit days; null when none. */
    peakUsagePct: number | null;
    peakUsageDate: string | null;
    /** Daily overshoot points (0 on under-100% limit days) for sparkline. */
    dailyOvershootPts: Array<{ snapshotDate: string; overshootPts: number }>;
};

export type LimitCappedThresholds = {
    minDays?: number;
    compliantCvMax?: number;
    arCvMin?: number;
    arGrowthMin?: number;
};

export type LimitCappedNormalizedPoint = {
    snapshotDate: string;
    /** 0–1 within the series' own min–max range. */
    totalArNormalized: number;
    compliantNormalized: number;
};

export type LimitCappedDetectionResult = {
    daysAvailable: number;
    /** True only when thresholds fire and window is long enough. */
    limitCapped: boolean;
    /** True when daysAvailable < minDays (flag forced false). */
    suppressed: boolean;
    compliantCv: number | null;
    totalArCv: number | null;
    /** (last − first) / |first| when first ≠ 0; null otherwise. */
    totalArGrowthPct: number | null;
    compliantGrowthPct: number | null;
    /** Dual series only when `limitCapped` is true; empty otherwise. */
    normalizedSeries: LimitCappedNormalizedPoint[];
};

export type CustomerOvershootLimitCappedMetrics = UtilizationOvershootMetrics & {
    limitCapped: LimitCappedDetectionResult;
};

function sortByDate<T extends CtpSnapshotDay>(points: T[]): T[] {
    return [...points].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate)
    );
}

/** Overshoot points above 100%; floors at 0 for at/under-100% days. */
export function utilizationOvershootPts(utilizationPct: number): number {
    if (!Number.isFinite(utilizationPct)) {
        return 0;
    }
    return Math.max(0, utilizationPct - 100);
}

function emptyOvershoot(): UtilizationOvershootMetrics {
    const emptySeries = analyzeBooleanDaySeries([]);
    return {
        daysAvailable: 0,
        daysWithLimit: 0,
        daysAboveLimit: 0,
        longestAboveLimitStreak: emptySeries.longestActiveStreak,
        avgOvershootPts: null,
        maxOvershootPts: null,
        maxOvershootDate: null,
        avgUsagePct: null,
        peakUsagePct: null,
        peakUsageDate: null,
        dailyOvershootPts: [],
    };
}

/**
 * Aggregate overshoot from available CTP utilization days.
 * Days with null utilization (no effective limit) are excluded from means —
 * never treated as 0%. Duplicate snapshot dates: last wins after sort merge
 * by caller; this helper expects one row per date.
 */
export function computeUtilizationOvershootMetrics(
    points: CtpUtilizationDayPoint[]
): UtilizationOvershootMetrics {
    const sorted = sortByDate(points);
    const daysAvailable = sorted.length;
    if (daysAvailable === 0) {
        return emptyOvershoot();
    }

    const aboveLimitSeries = analyzeBooleanDaySeries(
        sorted.map((p) => ({
            snapshotDate: p.snapshotDate,
            flag:
                p.utilizationPct != null &&
                Number.isFinite(p.utilizationPct) &&
                (p.utilizationPct as number) > 100,
        }))
    );

    const withLimit = sorted.filter(
        (p) => p.utilizationPct != null && Number.isFinite(p.utilizationPct)
    );
    if (withLimit.length === 0) {
        return {
            ...emptyOvershoot(),
            daysAvailable,
            daysAboveLimit: aboveLimitSeries.activeDayCount,
            longestAboveLimitStreak: aboveLimitSeries.longestActiveStreak,
        };
    }

    let sumOvershoot = 0;
    let sumUsage = 0;
    let maxOvershoot = -1;
    let maxOvershootDate: string | null = null;
    let peakUsage = -Infinity;
    let peakUsageDate: string | null = null;
    const dailyOvershootPts: UtilizationOvershootMetrics["dailyOvershootPts"] =
        [];

    for (const point of withLimit) {
        const usage = point.utilizationPct as number;
        const overshoot = utilizationOvershootPts(usage);
        sumOvershoot += overshoot;
        sumUsage += usage;
        dailyOvershootPts.push({
            snapshotDate: point.snapshotDate,
            overshootPts: overshoot,
        });
        if (overshoot > maxOvershoot) {
            maxOvershoot = overshoot;
            maxOvershootDate = point.snapshotDate;
        } else if (
            overshoot === maxOvershoot &&
            maxOvershootDate != null &&
            point.snapshotDate.localeCompare(maxOvershootDate) > 0
        ) {
            maxOvershootDate = point.snapshotDate;
        }
        if (usage > peakUsage) {
            peakUsage = usage;
            peakUsageDate = point.snapshotDate;
        } else if (
            usage === peakUsage &&
            peakUsageDate != null &&
            point.snapshotDate.localeCompare(peakUsageDate) > 0
        ) {
            peakUsageDate = point.snapshotDate;
        }
    }

    const n = withLimit.length;
    return {
        daysAvailable,
        daysWithLimit: n,
        daysAboveLimit: aboveLimitSeries.activeDayCount,
        longestAboveLimitStreak: aboveLimitSeries.longestActiveStreak,
        avgOvershootPts: sumOvershoot / n,
        maxOvershootPts: maxOvershoot >= 0 ? maxOvershoot : null,
        maxOvershootDate,
        avgUsagePct: sumUsage / n,
        peakUsagePct: Number.isFinite(peakUsage) ? peakUsage : null,
        peakUsageDate,
        dailyOvershootPts,
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

function coefficientOfVariation(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    if (mean === 0) {
        return null;
    }
    const stdev = sampleStdev(values);
    if (stdev == null) {
        return 0;
    }
    return Math.abs(stdev / mean);
}

function endToEndGrowthPct(values: number[]): number | null {
    if (values.length < 2) {
        return null;
    }
    const first = values[0];
    const last = values[values.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
        return null;
    }
    return (last - first) / Math.abs(first);
}

function normalizeSeries(values: number[]): number[] {
    if (values.length === 0) {
        return [];
    }
    let min = values[0];
    let max = values[0];
    for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const span = max - min;
    if (span === 0) {
        return values.map(() => 0.5);
    }
    return values.map((v) => (v - min) / span);
}

/**
 * Detect limit-capped compliant exposure: flat compliant CV + moving/growing AR.
 * Dual normalized series is returned only when the flag is true.
 */
export function detectLimitCapped(
    points: CtpLimitCappedDayPoint[],
    thresholds?: LimitCappedThresholds
): LimitCappedDetectionResult {
    const minDays = thresholds?.minDays ?? LIMIT_CAPPED_MIN_DAYS;
    const compliantCvMax =
        thresholds?.compliantCvMax ?? LIMIT_CAPPED_COMPLIANT_CV_MAX;
    const arCvMin = thresholds?.arCvMin ?? LIMIT_CAPPED_AR_CV_MIN;
    const arGrowthMin = thresholds?.arGrowthMin ?? LIMIT_CAPPED_AR_GROWTH_MIN;

    const sorted = sortByDate(
        points.filter(
            (p) =>
                Number.isFinite(p.totalReceivables) &&
                Number.isFinite(p.compliantExposure)
        )
    );
    const daysAvailable = sorted.length;
    if (daysAvailable === 0) {
        return {
            daysAvailable: 0,
            limitCapped: false,
            suppressed: true,
            compliantCv: null,
            totalArCv: null,
            totalArGrowthPct: null,
            compliantGrowthPct: null,
            normalizedSeries: [],
        };
    }

    const arValues = sorted.map((p) => p.totalReceivables);
    const compliantValues = sorted.map((p) => p.compliantExposure);
    const compliantCv = coefficientOfVariation(compliantValues);
    const totalArCv = coefficientOfVariation(arValues);
    const totalArGrowthPct = endToEndGrowthPct(arValues);
    const compliantGrowthPct = endToEndGrowthPct(compliantValues);

    const suppressed = daysAvailable < minDays;
    const limitCapped =
        !suppressed &&
        compliantCv != null &&
        totalArCv != null &&
        totalArGrowthPct != null &&
        compliantCv < compliantCvMax &&
        totalArCv > arCvMin &&
        totalArGrowthPct > arGrowthMin;

    let normalizedSeries: LimitCappedNormalizedPoint[] = [];
    if (limitCapped) {
        const arNorm = normalizeSeries(arValues);
        const compliantNorm = normalizeSeries(compliantValues);
        normalizedSeries = sorted.map((p, i) => ({
            snapshotDate: p.snapshotDate,
            totalArNormalized: arNorm[i],
            compliantNormalized: compliantNorm[i],
        }));
    }

    return {
        daysAvailable,
        limitCapped,
        suppressed,
        compliantCv,
        totalArCv,
        totalArGrowthPct,
        compliantGrowthPct,
        normalizedSeries,
    };
}

/**
 * Combined customer metrics from parallel utilization + AR/compliant series.
 */
export function computeCustomerOvershootLimitCappedMetrics(input: {
    utilizationPoints: CtpUtilizationDayPoint[];
    limitCappedPoints: CtpLimitCappedDayPoint[];
    limitCappedThresholds?: LimitCappedThresholds;
}): CustomerOvershootLimitCappedMetrics {
    return {
        ...computeUtilizationOvershootMetrics(input.utilizationPoints),
        limitCapped: detectLimitCapped(
            input.limitCappedPoints,
            input.limitCappedThresholds
        ),
    };
}

export type CustomerOvershootLimitCappedRow =
    CustomerOvershootLimitCappedMetrics & {
        customerId: number;
        customerName: string;
    };

export type PortfolioOvershootSummary = {
    customersWithData: number;
    /** Mean of per-customer avg overshoot; null when none. */
    avgOvershootPts: number | null;
    /** Highest avg overshoot customer (structural resize queue). */
    topAvgOvershootPts: number | null;
    topAvgOvershootCustomerId: number | null;
    topAvgOvershootCustomerName: string | null;
    limitCappedCustomerCount: number;
};

/**
 * Portfolio roll-up: only customers with ≥1 limit day contribute to overshoot
 * averages (null-limit customers stay excluded).
 */
export function summarizePortfolioOvershoot(
    rows: CustomerOvershootLimitCappedRow[]
): PortfolioOvershootSummary {
    const withLimit = rows.filter((r) => r.daysWithLimit > 0);
    const limitCappedCustomerCount = rows.filter(
        (r) => r.limitCapped.limitCapped
    ).length;

    if (withLimit.length === 0) {
        return {
            customersWithData: 0,
            avgOvershootPts: null,
            topAvgOvershootPts: null,
            topAvgOvershootCustomerId: null,
            topAvgOvershootCustomerName: null,
            limitCappedCustomerCount,
        };
    }

    const avgOvershootPts =
        withLimit.reduce((sum, r) => sum + (r.avgOvershootPts ?? 0), 0) /
        withLimit.length;

    let top = withLimit[0];
    for (let i = 1; i < withLimit.length; i += 1) {
        const row = withLimit[i];
        const pts = row.avgOvershootPts ?? 0;
        const topPts = top.avgOvershootPts ?? 0;
        if (pts > topPts) {
            top = row;
        }
    }

    return {
        customersWithData: withLimit.length,
        avgOvershootPts,
        topAvgOvershootPts: top.avgOvershootPts,
        topAvgOvershootCustomerId: top.customerId,
        topAvgOvershootCustomerName: top.customerName,
        limitCappedCustomerCount,
    };
}

/** Rank customers by avg overshoot DESC for PH Utilization / export. */
export function rankCustomersByOvershoot(
    rows: CustomerOvershootLimitCappedRow[]
): CustomerOvershootLimitCappedRow[] {
    return [...rows]
        .filter((r) => r.daysWithLimit > 0)
        .sort((a, b) => {
            const diff = (b.avgOvershootPts ?? 0) - (a.avgOvershootPts ?? 0);
            if (diff !== 0) return diff;
            return a.customerId - b.customerId;
        });
}
