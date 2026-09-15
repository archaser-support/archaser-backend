/**
 * Chronic over-limit metrics from CTP daily series (capacity_gap_amount > 0).
 * Available-day denominators and streak gaps use {@link analyzeBooleanDaySeries}.
 */

import {
    analyzeBooleanDaySeries,
    type BooleanDaySeriesAnalysis,
    type CtpSnapshotDay,
    type StreakWindow,
} from "./ctpDailySeries";

export type CtpCapacityGapDayPoint = CtpSnapshotDay & {
    /** Account-currency capacity gap for the day (summed across policies when needed). */
    capacityGapAmount: number;
};

export type CustomerOverLimitGapMetrics = {
    daysAvailable: number;
    overLimitDayCount: number;
    /** Null when zero available days (never invent 0%). */
    pctDaysOverLimit: number | null;
    longestOverLimitStreak: StreakWindow;
    currentOverLimitStreak: StreakWindow;
    series: BooleanDaySeriesAnalysis;
};

function emptyMetrics(): CustomerOverLimitGapMetrics {
    const series = analyzeBooleanDaySeries([]);
    return {
        daysAvailable: 0,
        overLimitDayCount: 0,
        pctDaysOverLimit: null,
        longestOverLimitStreak: series.longestActiveStreak,
        currentOverLimitStreak: series.currentActiveStreak,
        series,
    };
}

/** True when the day counts as over-limit / capacity-gap active. */
export function isCapacityGapOverLimitDay(capacityGapAmount: number): boolean {
    return Number.isFinite(capacityGapAmount) && capacityGapAmount > 0;
}

/**
 * Aggregate one customer's available CTP days into over-limit metrics.
 * Duplicate snapshot dates are summed (multi-policy) before analysis.
 */
export function computeCustomerOverLimitGapMetrics(
    points: CtpCapacityGapDayPoint[]
): CustomerOverLimitGapMetrics {
    if (points.length === 0) {
        return emptyMetrics();
    }

    const byDate = new Map<string, number>();
    for (const point of points) {
        const gap = Number.isFinite(point.capacityGapAmount)
            ? Math.max(0, point.capacityGapAmount)
            : 0;
        byDate.set(
            point.snapshotDate,
            (byDate.get(point.snapshotDate) ?? 0) + gap
        );
    }

    const merged = [...byDate.entries()]
        .map(([snapshotDate, capacityGapAmount]) => ({
            snapshotDate,
            capacityGapAmount,
        }))
        .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

    const booleanPoints = merged.map((p) => ({
        snapshotDate: p.snapshotDate,
        flag: isCapacityGapOverLimitDay(p.capacityGapAmount),
    }));
    const series = analyzeBooleanDaySeries(booleanPoints);
    const daysAvailable = series.daysAvailable;
    if (daysAvailable === 0) {
        return emptyMetrics();
    }

    return {
        daysAvailable,
        overLimitDayCount: series.activeDayCount,
        pctDaysOverLimit: series.pctActiveDays,
        longestOverLimitStreak: series.longestActiveStreak,
        currentOverLimitStreak: series.currentActiveStreak,
        series,
    };
}

export type PortfolioOverLimitGapSummary = {
    customersWithData: number;
    longestStreakDays: number;
    longestStreakStart: string | null;
    longestStreakEnd: string | null;
    longestStreakCustomerId: number | null;
    longestStreakCustomerName: string | null;
};

export type CustomerOverLimitGapRow = {
    customerId: number;
    customerName: string;
} & CustomerOverLimitGapMetrics;

/**
 * Portfolio roll-up from per-customer metrics (customers with 0 available days
 * are excluded from the with-data count).
 */
export function summarizePortfolioOverLimitGap(
    rows: CustomerOverLimitGapRow[]
): PortfolioOverLimitGapSummary {
    const withData = rows.filter((r) => r.daysAvailable > 0);
    if (withData.length === 0) {
        return {
            customersWithData: 0,
            longestStreakDays: 0,
            longestStreakStart: null,
            longestStreakEnd: null,
            longestStreakCustomerId: null,
            longestStreakCustomerName: null,
        };
    }

    let best = withData[0];
    for (let i = 1; i < withData.length; i += 1) {
        const row = withData[i];
        const days = row.longestOverLimitStreak.days;
        const bestDays = best.longestOverLimitStreak.days;
        if (days > bestDays) {
            best = row;
            continue;
        }
        if (days === bestDays && days > 0) {
            const end = row.longestOverLimitStreak.end ?? "";
            const bestEnd = best.longestOverLimitStreak.end ?? "";
            if (end.localeCompare(bestEnd) > 0) {
                best = row;
            }
        }
    }

    return {
        customersWithData: withData.length,
        longestStreakDays: best.longestOverLimitStreak.days,
        longestStreakStart: best.longestOverLimitStreak.start,
        longestStreakEnd: best.longestOverLimitStreak.end,
        longestStreakCustomerId:
            best.longestOverLimitStreak.days > 0 ? best.customerId : null,
        longestStreakCustomerName:
            best.longestOverLimitStreak.days > 0 ? best.customerName : null,
    };
}
