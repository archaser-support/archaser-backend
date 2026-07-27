import { Prisma } from "@prisma/client";

import { prisma } from "../domain-db";
import { parsePortfolioHealthDateRange } from "./shared/portfolioHealthDateRange";
import {
    isPendingReviewExclusion,
    normalizePolicyExclusionReason,
} from "./shared/policyExclusion";
import { computeCreditDashboardHealthIndex } from "./creditDashboardSnapshotService";
import type { TermsBreachByReasonSnapshotKey } from "./customerPolicyTrendTermsBreachByReason";

export const PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT = 85;
export const INSURER_DECLINED_REASON = "Insurer declined";

export const NO_COVERAGE_REASON_KEYS = [
    "pending_review",
    "credit_hold",
    "insurer_declined",
    "other",
    "no_linked_policy",
] as const;

export type NoCoverageReasonKey = (typeof NO_COVERAGE_REASON_KEYS)[number];

export type ExactValueStreakWindow = {
    days: number;
    start: string | null;
    end: string | null;
};

export type PortfolioHealthSeriesMetrics = {
    averageHealthPct: number;
    lowestHealthPct: number;
    lowestHealthStreakDays: number;
    /** Inclusive YYYY-MM-DD start of the longest trough streak (most recent on ties). */
    lowestHealthStreakStart: string | null;
    /** Inclusive YYYY-MM-DD end of the longest trough streak (most recent on ties). */
    lowestHealthStreakEnd: string | null;
    pctDaysBelow85: number;
};

export type PortfolioHealthDailyPoint = {
    snapshotDate: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
    healthIndex: number;
};

export type PortfolioHealthMonthlyPoint = {
    month: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
};

export type PortfolioHealthSection = {
    seriesA: PortfolioHealthSeriesMetrics;
    seriesB: PortfolioHealthSeriesMetrics;
    dailyA: PortfolioHealthDailyPoint[];
    dailyB: PortfolioHealthDailyPoint[];
    monthlyA: PortfolioHealthMonthlyPoint[];
    monthlyB: PortfolioHealthMonthlyPoint[];
};

export type PortfolioNoCoverageDailyPoint = {
    snapshotDate: string;
    totalCustomerCount: number;
    uncoveredCustomerCount: number;
    uncoveredAmount: number;
    approvedTotalReceivables: number;
    approvedTermsBreachAmount: number;
    amountByReason: Partial<Record<NoCoverageReasonKey, number>>;
    customerCountByReason: Partial<Record<NoCoverageReasonKey, number>>;
    breachAmountByReason: Partial<
        Record<TermsBreachByReasonSnapshotKey | string, number>
    >;
};

export type PortfolioNoCoverageReasonItem = {
    reason: NoCoverageReasonKey;
    averageAmount: number;
    averageCustomerCount: number;
};

export type PortfolioNoCoverageSection = {
    averageUncoveredCustomerPct: number;
    averageUncoveredAmount: number;
    averageUncoveredCustomerCount: number;
    reasons: PortfolioNoCoverageReasonItem[];
    averageViolationPct: number;
    mainViolationReason: string | null;
    mainViolationReasonSharePct: number;
    totalBreachAmount: number;
};

export const UTILIZATION_DISTRIBUTION_BIN_KEYS = [
    "0_10",
    "10_20",
    "20_50",
    "50_75",
    "75_plus",
] as const;

export type UtilizationDistributionBinKey =
    (typeof UTILIZATION_DISTRIBUTION_BIN_KEYS)[number];

export type PortfolioUtilizationDailyPoint = {
    snapshotDate: string;
    /** Portfolio effective util % for approved rows; null when limit sum is 0. */
    utilizationPct: number | null;
    /** Size-weighted top-up util % among rows with top_up_total > 0; null if none. */
    topUpUtilizationPct: number | null;
    activeTopUpCountSum: number;
    customersWithActiveTopUp: number;
};

export type PortfolioUtilizationTopCustomer = {
    customerId: number;
    customerName: string;
    usageAmount: number;
    /** Coverage/utilization % vs effective limit; null when limit ≤ 0. */
    utilizationPct: number | null;
};

export type PortfolioUtilizationDistributionBin = {
    bin: UtilizationDistributionBinKey;
    customerCount: number;
    customerPct: number;
};

export type PortfolioUtilizationSection = {
    averageUtilizationPct: number;
    pctDaysAbove100: number;
    peakUtilizationPct: number;
    peakUtilizationStreakDays: number;
    peakUtilizationStreakStart: string | null;
    peakUtilizationStreakEnd: string | null;
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    averageTopUpUtilizationPct: number | null;
    averageDailyTopUpCount: number;
    averageDailyCustomersWithTopUp: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    efficiencyA: number | null;
    efficiencyB: number | null;
    distribution: PortfolioUtilizationDistributionBin[];
    distributionCustomerCount: number;
};

export type PortfolioCostDailyPoint = {
    snapshotDate: string;
    /** Sum of approved-row `total_daily_cost` for the day (includes top-ups). */
    totalDailyCost: number;
};

export type PortfolioCostsSection = {
    periodCost: number;
    daily: PortfolioCostDailyPoint[];
    averageCompliantExposure: number;
    /**
     * Period cost ÷ average daily compliant exposure.
     * Null when average compliant exposure is 0 (guard).
     */
    effectiveCost: number | null;
    /** ISO currency code from the account (e.g. ILS, USD). */
    accountCurrency: string;
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    /** Always null until a policy-level deductible field exists. */
    deductiblePct: null;
};

export type CreditPortfolioHealthResponse = {
    from: string;
    to: string;
    daysAvailable: number;
    daysInRange: number;
    portfolioHealth: PortfolioHealthSection | null;
    noCoverage: PortfolioNoCoverageSection | null;
    utilization: PortfolioUtilizationSection | null;
    costs: PortfolioCostsSection | null;
};

export type CreditPortfolioHealthQuery = {
    from: string;
    to: string;
    policyId?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
    includeNoPolicyExposure: boolean;
    selectedBusinessUnitId?: number | null;
    accessibleBusinessUnitIds?: number[] | null;
    isAdmin?: boolean;
};

type CptDailyAggregateRow = {
    snapshot_date: Date;
    total_a: number | string;
    compliant_a: number | string;
    at_risk_a: number | string;
    total_b: number | string;
    compliant_b: number | string;
    at_risk_b: number | string;
};

type WithoutPolicyDayRow = {
    snapshot_date: Date;
    without_policy_total_amount: number | string;
    without_policy_customer_count: number | string;
};

type CptNoCoverageDayRow = {
    snapshot_date: Date;
    total_customers: number | string;
    uncovered_customers: number | string;
    uncovered_amount: number | string;
    approved_ar: number | string;
    approved_breach: number | string;
};

type CptNoCoverageReasonDayRow = {
    snapshot_date: Date;
    reason_key: string;
    customer_count: number | string;
    amount: number | string;
};

type CptBreachReasonDayRow = {
    snapshot_date: Date;
    reason_key: string;
    amount: number | string;
};

function toNumber(value: number | string | null | undefined): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
}

function normalizeDateString(value: Date): string {
    return value.toISOString().slice(0, 10);
}

function utcDayPlusOne(ymd: string): string {
    const d = new Date(`${ymd}T12:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

export function isInsurerDeclinedReason(reason: unknown): boolean {
    if (reason == null) {
        return false;
    }
    return String(reason).trim().toLowerCase() === INSURER_DECLINED_REASON.toLowerCase();
}

/**
 * Calendar-consecutive longest run of days whose value equals `target`.
 * Returns length plus inclusive start/end dates. When multiple equal-length
 * streaks exist, picks the most recent (later end date). Reusable for trough
 * and peak (pass min or max as `target`).
 */
export function longestExactValueStreakWindow(
    points: Array<{ snapshotDate: string; value: number }>,
    target: number
): ExactValueStreakWindow {
    if (points.length === 0) {
        return { days: 0, start: null, end: null };
    }
    const sorted = [...points].sort((a, b) =>
        a.snapshotDate.localeCompare(b.snapshotDate)
    );
    let bestDays = 0;
    let bestStart: string | null = null;
    let bestEnd: string | null = null;
    let current = 0;
    let currentStart: string | null = null;
    let prevDate: string | null = null;

    for (const point of sorted) {
        if (point.value !== target) {
            current = 0;
            currentStart = null;
            prevDate = point.snapshotDate;
            continue;
        }
        const continuesCalendarDay =
            current > 0 &&
            prevDate != null &&
            utcDayPlusOne(prevDate) === point.snapshotDate;
        if (continuesCalendarDay) {
            current += 1;
        } else {
            current = 1;
            currentStart = point.snapshotDate;
        }
        // Longer wins; equal length → most recent (ASC scan, so >= takes later).
        if (current >= bestDays) {
            bestDays = current;
            bestStart = currentStart;
            bestEnd = point.snapshotDate;
        }
        prevDate = point.snapshotDate;
    }
    return { days: bestDays, start: bestStart, end: bestEnd };
}

/** Calendar-consecutive longest run of days whose value equals `target`. */
export function longestExactValueStreak(
    points: Array<{ snapshotDate: string; value: number }>,
    target: number
): number {
    return longestExactValueStreakWindow(points, target).days;
}

export function buildDailyHealthPoint(input: {
    snapshotDate: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
}): PortfolioHealthDailyPoint {
    return {
        snapshotDate: input.snapshotDate,
        totalReceivables: input.totalReceivables,
        compliantExposure: input.compliantExposure,
        atRiskExposure: input.atRiskExposure,
        healthIndex: computeCreditDashboardHealthIndex(
            input.compliantExposure,
            input.totalReceivables
        ),
    };
}

export function computePortfolioHealthSeriesMetrics(
    daily: PortfolioHealthDailyPoint[]
): PortfolioHealthSeriesMetrics {
    if (daily.length === 0) {
        return {
            averageHealthPct: 0,
            lowestHealthPct: 0,
            lowestHealthStreakDays: 0,
            lowestHealthStreakStart: null,
            lowestHealthStreakEnd: null,
            pctDaysBelow85: 0,
        };
    }

    const healthValues = daily.map((d) => d.healthIndex);
    const averageHealthPct =
        healthValues.reduce((sum, v) => sum + v, 0) / healthValues.length;
    const lowestHealthPct = Math.min(...healthValues);
    const troughWindow = longestExactValueStreakWindow(
        daily.map((d) => ({
            snapshotDate: d.snapshotDate,
            value: d.healthIndex,
        })),
        lowestHealthPct
    );
    const belowCount = healthValues.filter(
        (v) => v < PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT
    ).length;
    const pctDaysBelow85 = (100 * belowCount) / healthValues.length;

    return {
        averageHealthPct,
        lowestHealthPct,
        lowestHealthStreakDays: troughWindow.days,
        lowestHealthStreakStart: troughWindow.start,
        lowestHealthStreakEnd: troughWindow.end,
        pctDaysBelow85,
    };
}

/** Mean of available daily stock amounts per calendar month (YYYY-MM). */
export function aggregateDailyHealthToMonthly(
    daily: PortfolioHealthDailyPoint[]
): PortfolioHealthMonthlyPoint[] {
    const byMonth = new Map<
        string,
        {
            totalReceivables: number;
            compliantExposure: number;
            atRiskExposure: number;
            count: number;
        }
    >();

    for (const point of daily) {
        const month = point.snapshotDate.slice(0, 7);
        const bucket = byMonth.get(month) ?? {
            totalReceivables: 0,
            compliantExposure: 0,
            atRiskExposure: 0,
            count: 0,
        };
        bucket.totalReceivables += point.totalReceivables;
        bucket.compliantExposure += point.compliantExposure;
        bucket.atRiskExposure += point.atRiskExposure;
        bucket.count += 1;
        byMonth.set(month, bucket);
    }

    return Array.from(byMonth.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, bucket]) => ({
            month,
            totalReceivables: bucket.totalReceivables / bucket.count,
            compliantExposure: bucket.compliantExposure / bucket.count,
            atRiskExposure: bucket.atRiskExposure / bucket.count,
        }));
}

/**
 * Build dual daily series from CPT day aggregates, optionally adding
 * historical without-policy AR (increases total + at-risk; compliant unchanged).
 */
export function buildDualDailyHealthSeries(
    rows: Array<{
        snapshotDate: string;
        totalA: number;
        compliantA: number;
        atRiskA: number;
        totalB: number;
        compliantB: number;
        atRiskB: number;
    }>,
    withoutPolicyByDate: Map<string, number>,
    includeNoPolicyExposure: boolean
): { dailyA: PortfolioHealthDailyPoint[]; dailyB: PortfolioHealthDailyPoint[] } {
    const dailyA: PortfolioHealthDailyPoint[] = [];
    const dailyB: PortfolioHealthDailyPoint[] = [];

    for (const row of rows) {
        const withoutPolicy =
            includeNoPolicyExposure
                ? withoutPolicyByDate.get(row.snapshotDate) ?? 0
                : 0;

        dailyA.push(
            buildDailyHealthPoint({
                snapshotDate: row.snapshotDate,
                totalReceivables: row.totalA + withoutPolicy,
                compliantExposure: row.compliantA,
                atRiskExposure: row.atRiskA + withoutPolicy,
            })
        );
        dailyB.push(
            buildDailyHealthPoint({
                snapshotDate: row.snapshotDate,
                totalReceivables: row.totalB + withoutPolicy,
                compliantExposure: row.compliantB,
                atRiskExposure: row.atRiskB + withoutPolicy,
            })
        );
    }

    return { dailyA, dailyB };
}

export function buildPortfolioHealthSection(
    dailyA: PortfolioHealthDailyPoint[],
    dailyB: PortfolioHealthDailyPoint[]
): PortfolioHealthSection {
    return {
        seriesA: computePortfolioHealthSeriesMetrics(dailyA),
        seriesB: computePortfolioHealthSeriesMetrics(dailyB),
        dailyA,
        dailyB,
        monthlyA: aggregateDailyHealthToMonthly(dailyA),
        monthlyB: aggregateDailyHealthToMonthly(dailyB),
    };
}

/** Whether a CPT row belongs in Health A when the no-policy cohort toggle is off. */
export function shouldIncludeCptRowInHealthScope(input: {
    includeNoPolicyExposure: boolean;
    exclusionReason: unknown;
    totalReceivables: number;
}): boolean {
    if (input.includeNoPolicyExposure) {
        return true;
    }
    if (input.totalReceivables <= 0) {
        return true;
    }
    return !isPendingReviewExclusion(input.exclusionReason);
}

export function roundToOneDecimal(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Map a CPT-style row into an allowlisted No Coverage reason, or null when approved.
 */
export function classifyNoCoverageReason(input: {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
}): NoCoverageReasonKey | null {
    if (!input.hasLinkedPolicy) {
        return "no_linked_policy";
    }
    const normalized = normalizePolicyExclusionReason(input.exclusionReason);
    if (!normalized) {
        return null;
    }
    const lower = normalized.toLowerCase();
    if (lower === "pending review") {
        return "pending_review";
    }
    if (lower === "credit hold") {
        return "credit_hold";
    }
    if (lower === "insurer declined") {
        return "insurer_declined";
    }
    return "other";
}

export function isApprovedCoverageCustomer(input: {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
}): boolean {
    return classifyNoCoverageReason(input) == null;
}

export function pickMainViolationReason(
    amountsByReason: Record<string, number>
): { reason: string | null; sharePct: number; totalAmount: number } {
    let totalAmount = 0;
    let bestReason: string | null = null;
    let bestAmount = 0;

    for (const [reason, amount] of Object.entries(amountsByReason)) {
        if (!(amount > 0)) {
            continue;
        }
        totalAmount += amount;
        if (amount > bestAmount) {
            bestAmount = amount;
            bestReason = reason;
        }
    }

    if (bestReason == null || totalAmount <= 0) {
        return { reason: null, sharePct: 0, totalAmount };
    }

    return {
        reason: bestReason,
        sharePct: (100 * bestAmount) / totalAmount,
        totalAmount,
    };
}

export function emptyNoCoverageReasonMaps(): {
    amountByReason: Partial<Record<NoCoverageReasonKey, number>>;
    customerCountByReason: Partial<Record<NoCoverageReasonKey, number>>;
} {
    return { amountByReason: {}, customerCountByReason: {} };
}

export function applyWithoutPolicyToNoCoverageDay(
    day: PortfolioNoCoverageDailyPoint,
    withoutPolicy: { customerCount: number; amount: number } | undefined,
    includeNoPolicyExposure: boolean
): PortfolioNoCoverageDailyPoint {
    if (!includeNoPolicyExposure || withoutPolicy == null) {
        return day;
    }
    const { customerCount, amount } = withoutPolicy;
    if (customerCount <= 0 && amount <= 0) {
        return day;
    }
    return {
        ...day,
        totalCustomerCount: day.totalCustomerCount + customerCount,
        uncoveredCustomerCount: day.uncoveredCustomerCount + customerCount,
        uncoveredAmount: day.uncoveredAmount + amount,
        amountByReason: {
            ...day.amountByReason,
            no_linked_policy:
                (day.amountByReason.no_linked_policy ?? 0) + amount,
        },
        customerCountByReason: {
            ...day.customerCountByReason,
            no_linked_policy:
                (day.customerCountByReason.no_linked_policy ?? 0) +
                customerCount,
        },
    };
}

export function buildNoCoverageSection(
    daily: PortfolioNoCoverageDailyPoint[]
): PortfolioNoCoverageSection {
    if (daily.length === 0) {
        return {
            averageUncoveredCustomerPct: 0,
            averageUncoveredAmount: 0,
            averageUncoveredCustomerCount: 0,
            reasons: NO_COVERAGE_REASON_KEYS.map((reason) => ({
                reason,
                averageAmount: 0,
                averageCustomerCount: 0,
            })),
            averageViolationPct: 0,
            mainViolationReason: null,
            mainViolationReasonSharePct: 0,
            totalBreachAmount: 0,
        };
    }

    const dayCount = daily.length;
    let sumCustomerPct = 0;
    let sumUncoveredAmount = 0;
    let sumUncoveredCustomers = 0;
    let sumViolationPct = 0;
    const sumAmountByReason = Object.fromEntries(
        NO_COVERAGE_REASON_KEYS.map((key) => [key, 0])
    ) as Record<NoCoverageReasonKey, number>;
    const sumCustomersByReason = Object.fromEntries(
        NO_COVERAGE_REASON_KEYS.map((key) => [key, 0])
    ) as Record<NoCoverageReasonKey, number>;
    const breachTotals: Record<string, number> = {};

    for (const day of daily) {
        sumCustomerPct +=
            day.totalCustomerCount > 0
                ? (100 * day.uncoveredCustomerCount) / day.totalCustomerCount
                : 0;
        sumUncoveredAmount += day.uncoveredAmount;
        sumUncoveredCustomers += day.uncoveredCustomerCount;
        sumViolationPct +=
            day.approvedTotalReceivables > 0
                ? (100 * day.approvedTermsBreachAmount) /
                  day.approvedTotalReceivables
                : 0;

        for (const key of NO_COVERAGE_REASON_KEYS) {
            sumAmountByReason[key] += day.amountByReason[key] ?? 0;
            sumCustomersByReason[key] += day.customerCountByReason[key] ?? 0;
        }
        for (const [reason, amount] of Object.entries(
            day.breachAmountByReason
        )) {
            const breachAmount = amount ?? 0;
            if (!(breachAmount > 0)) {
                continue;
            }
            breachTotals[reason] = (breachTotals[reason] ?? 0) + breachAmount;
        }
    }

    const main = pickMainViolationReason(breachTotals);

    return {
        averageUncoveredCustomerPct: sumCustomerPct / dayCount,
        averageUncoveredAmount: sumUncoveredAmount / dayCount,
        averageUncoveredCustomerCount: roundToOneDecimal(
            sumUncoveredCustomers / dayCount
        ),
        reasons: NO_COVERAGE_REASON_KEYS.map((reason) => ({
            reason,
            averageAmount: sumAmountByReason[reason] / dayCount,
            averageCustomerCount: roundToOneDecimal(
                sumCustomersByReason[reason] / dayCount
            ),
        })),
        averageViolationPct: sumViolationPct / dayCount,
        mainViolationReason: main.reason,
        mainViolationReasonSharePct: main.sharePct,
        totalBreachAmount: main.totalAmount,
    };
}

/**
 * Portfolio-level effective utilization for one day.
 * Returns null when the effective-limit denominator is ≤ 0 (caller excludes from averages).
 */
export function computeDailyPortfolioUtilizationPct(
    usageSum: number,
    effectiveLimitSum: number
): number | null {
    if (!(effectiveLimitSum > 0)) {
        return null;
    }
    return (100 * Math.max(0, usageSum)) / effectiveLimitSum;
}

/**
 * Size-weighted top-up utilization for one day among rows with top_up_total > 0.
 * Uses sum(topUpUsage × topUpTotal) / sum(topUpTotal) × 100.
 */
export function computeDailyTopUpUtilizationPct(
    weightedUsageSum: number,
    topUpTotalSum: number
): number | null {
    if (!(topUpTotalSum > 0)) {
        return null;
    }
    return (100 * Math.max(0, weightedUsageSum)) / topUpTotalSum;
}

/** Exclusive utilization distribution bins. Boundaries: [0,10), [10,20), [20,50), [50,75), [75,∞). */
export function assignUtilizationDistributionBin(
    utilizationPct: number
): UtilizationDistributionBinKey {
    if (utilizationPct < 10) {
        return "0_10";
    }
    if (utilizationPct < 20) {
        return "10_20";
    }
    if (utilizationPct < 50) {
        return "20_50";
    }
    if (utilizationPct < 75) {
        return "50_75";
    }
    return "75_plus";
}

export function buildUtilizationDistribution(
    customers: Array<{ utilizationPct: number }>
): {
    bins: PortfolioUtilizationDistributionBin[];
    customerCount: number;
} {
    const counts = Object.fromEntries(
        UTILIZATION_DISTRIBUTION_BIN_KEYS.map((key) => [key, 0])
    ) as Record<UtilizationDistributionBinKey, number>;

    for (const customer of customers) {
        counts[assignUtilizationDistributionBin(customer.utilizationPct)] += 1;
    }

    const customerCount = customers.length;
    const bins = UTILIZATION_DISTRIBUTION_BIN_KEYS.map((bin) => ({
        bin,
        customerCount: counts[bin],
        customerPct:
            customerCount > 0 ? (100 * counts[bin]) / customerCount : 0,
    }));

    return { bins, customerCount };
}

export function computePolicyEfficiency(
    healthPct: number,
    utilizationPct: number
): number | null {
    if (!(utilizationPct > 0)) {
        return null;
    }
    return healthPct / utilizationPct;
}

export function computeSelfVsApprovedShares(
    daily: PortfolioNoCoverageDailyPoint[]
): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
} {
    if (daily.length === 0) {
        return {
            selfUnderwrittenCustomerPct: 0,
            selfUnderwrittenArSharePct: 0,
            approvedCustomerPct: 0,
            approvedArSharePct: 0,
        };
    }

    let sumSelfCustomerPct = 0;
    let sumApprovedCustomerPct = 0;
    let sumSelfArShare = 0;
    let sumApprovedArShare = 0;

    for (const day of daily) {
        sumSelfCustomerPct +=
            day.totalCustomerCount > 0
                ? (100 * day.uncoveredCustomerCount) / day.totalCustomerCount
                : 0;
        sumApprovedCustomerPct +=
            day.totalCustomerCount > 0
                ? (100 *
                      (day.totalCustomerCount - day.uncoveredCustomerCount)) /
                  day.totalCustomerCount
                : 0;
        const totalAr = day.uncoveredAmount + day.approvedTotalReceivables;
        sumSelfArShare +=
            totalAr > 0 ? (100 * day.uncoveredAmount) / totalAr : 0;
        sumApprovedArShare +=
            totalAr > 0
                ? (100 * day.approvedTotalReceivables) / totalAr
                : 0;
    }

    const n = daily.length;
    return {
        selfUnderwrittenCustomerPct: sumSelfCustomerPct / n,
        selfUnderwrittenArSharePct: sumSelfArShare / n,
        approvedCustomerPct: sumApprovedCustomerPct / n,
        approvedArSharePct: sumApprovedArShare / n,
    };
}

export function computeUtilizationPeriodMetrics(
    daily: PortfolioUtilizationDailyPoint[]
): {
    averageUtilizationPct: number;
    pctDaysAbove100: number;
    peakUtilizationPct: number;
    peakUtilizationStreakDays: number;
    peakUtilizationStreakStart: string | null;
    peakUtilizationStreakEnd: string | null;
    averageTopUpUtilizationPct: number | null;
    averageDailyTopUpCount: number;
    averageDailyCustomersWithTopUp: number;
} {
    const utilDays = daily.filter(
        (d): d is PortfolioUtilizationDailyPoint & { utilizationPct: number } =>
            d.utilizationPct != null
    );

    if (utilDays.length === 0) {
        const dayCount = daily.length;
        const topUpDays = daily.filter((d) => d.topUpUtilizationPct != null);
        return {
            averageUtilizationPct: 0,
            pctDaysAbove100: 0,
            peakUtilizationPct: 0,
            peakUtilizationStreakDays: 0,
            peakUtilizationStreakStart: null,
            peakUtilizationStreakEnd: null,
            averageTopUpUtilizationPct:
                topUpDays.length > 0
                    ? topUpDays.reduce(
                          (sum, d) => sum + (d.topUpUtilizationPct ?? 0),
                          0
                      ) / topUpDays.length
                    : null,
            averageDailyTopUpCount:
                dayCount > 0
                    ? roundToOneDecimal(
                          daily.reduce((sum, d) => sum + d.activeTopUpCountSum, 0) /
                              dayCount
                      )
                    : 0,
            averageDailyCustomersWithTopUp:
                dayCount > 0
                    ? roundToOneDecimal(
                          daily.reduce(
                              (sum, d) => sum + d.customersWithActiveTopUp,
                              0
                          ) / dayCount
                      )
                    : 0,
        };
    }

    const averageUtilizationPct =
        utilDays.reduce((sum, d) => sum + d.utilizationPct, 0) /
        utilDays.length;
    const aboveCount = utilDays.filter((d) => d.utilizationPct > 100).length;
    const pctDaysAbove100 = (100 * aboveCount) / utilDays.length;
    const peakUtilizationPct = Math.max(
        ...utilDays.map((d) => d.utilizationPct)
    );
    const peakWindow = longestExactValueStreakWindow(
        utilDays.map((d) => ({
            snapshotDate: d.snapshotDate,
            value: d.utilizationPct,
        })),
        peakUtilizationPct
    );

    const topUpDays = daily.filter((d) => d.topUpUtilizationPct != null);
    const dayCount = daily.length;

    return {
        averageUtilizationPct,
        pctDaysAbove100,
        peakUtilizationPct,
        peakUtilizationStreakDays: peakWindow.days,
        peakUtilizationStreakStart: peakWindow.start,
        peakUtilizationStreakEnd: peakWindow.end,
        averageTopUpUtilizationPct:
            topUpDays.length > 0
                ? topUpDays.reduce(
                      (sum, d) => sum + (d.topUpUtilizationPct ?? 0),
                      0
                  ) / topUpDays.length
                : null,
        averageDailyTopUpCount:
            dayCount > 0
                ? roundToOneDecimal(
                      daily.reduce((sum, d) => sum + d.activeTopUpCountSum, 0) /
                          dayCount
                  )
                : 0,
        averageDailyCustomersWithTopUp:
            dayCount > 0
                ? roundToOneDecimal(
                      daily.reduce(
                          (sum, d) => sum + d.customersWithActiveTopUp,
                          0
                      ) / dayCount
                  )
                : 0,
    };
}

export function emptyUtilizationSection(): PortfolioUtilizationSection {
    return {
        averageUtilizationPct: 0,
        pctDaysAbove100: 0,
        peakUtilizationPct: 0,
        peakUtilizationStreakDays: 0,
        peakUtilizationStreakStart: null,
        peakUtilizationStreakEnd: null,
        selfUnderwrittenCustomerPct: 0,
        selfUnderwrittenArSharePct: 0,
        approvedCustomerPct: 0,
        approvedArSharePct: 0,
        averageTopUpUtilizationPct: null,
        averageDailyTopUpCount: 0,
        averageDailyCustomersWithTopUp: 0,
        topCustomers: [],
        efficiencyA: null,
        efficiencyB: null,
        distribution: UTILIZATION_DISTRIBUTION_BIN_KEYS.map((bin) => ({
            bin,
            customerCount: 0,
            customerPct: 0,
        })),
        distributionCustomerCount: 0,
    };
}

export function buildUtilizationSection(input: {
    daily: PortfolioUtilizationDailyPoint[];
    noCoverageDaily: PortfolioNoCoverageDailyPoint[];
    healthAverageA: number;
    healthAverageB: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    distributionCustomers: Array<{ utilizationPct: number }>;
}): PortfolioUtilizationSection {
    const period = computeUtilizationPeriodMetrics(input.daily);
    const shares = computeSelfVsApprovedShares(input.noCoverageDaily);
    const distribution = buildUtilizationDistribution(
        input.distributionCustomers
    );

    return {
        averageUtilizationPct: period.averageUtilizationPct,
        pctDaysAbove100: period.pctDaysAbove100,
        peakUtilizationPct: period.peakUtilizationPct,
        peakUtilizationStreakDays: period.peakUtilizationStreakDays,
        peakUtilizationStreakStart: period.peakUtilizationStreakStart,
        peakUtilizationStreakEnd: period.peakUtilizationStreakEnd,
        selfUnderwrittenCustomerPct: shares.selfUnderwrittenCustomerPct,
        selfUnderwrittenArSharePct: shares.selfUnderwrittenArSharePct,
        approvedCustomerPct: shares.approvedCustomerPct,
        approvedArSharePct: shares.approvedArSharePct,
        averageTopUpUtilizationPct: period.averageTopUpUtilizationPct,
        averageDailyTopUpCount: period.averageDailyTopUpCount,
        averageDailyCustomersWithTopUp: period.averageDailyCustomersWithTopUp,
        topCustomers: input.topCustomers,
        efficiencyA: computePolicyEfficiency(
            input.healthAverageA,
            period.averageUtilizationPct
        ),
        efficiencyB: computePolicyEfficiency(
            input.healthAverageB,
            period.averageUtilizationPct
        ),
        distribution: distribution.bins,
        distributionCustomerCount: distribution.customerCount,
    };
}

/**
 * Period policy cost = sum of daily approved `total_daily_cost` (includes top-ups).
 */
export function computePeriodCost(daily: PortfolioCostDailyPoint[]): number {
    return daily.reduce((sum, d) => sum + d.totalDailyCost, 0);
}

/**
 * Effective cost = period cost ÷ average daily compliant exposure.
 * Returns null when average compliant exposure is 0.
 */
export function computeEffectiveCost(
    periodCost: number,
    averageCompliantExposure: number
): number | null {
    if (!(averageCompliantExposure > 0)) {
        return null;
    }
    return periodCost / averageCompliantExposure;
}

export function computeAverageCompliantExposure(
    dailyHealth: Array<{ compliantExposure: number }>
): number {
    if (dailyHealth.length === 0) {
        return 0;
    }
    return (
        dailyHealth.reduce((sum, d) => sum + d.compliantExposure, 0) /
        dailyHealth.length
    );
}

export function emptyCostsSection(
    accountCurrency = "USD"
): PortfolioCostsSection {
    return {
        periodCost: 0,
        daily: [],
        averageCompliantExposure: 0,
        effectiveCost: null,
        accountCurrency,
        selfUnderwrittenCustomerPct: 0,
        selfUnderwrittenArSharePct: 0,
        approvedCustomerPct: 0,
        approvedArSharePct: 0,
        deductiblePct: null,
    };
}

export function buildCostsSection(input: {
    daily: PortfolioCostDailyPoint[];
    dailyHealth: Array<{ compliantExposure: number }>;
    noCoverageDaily: PortfolioNoCoverageDailyPoint[];
    accountCurrency: string;
}): PortfolioCostsSection {
    const periodCost = computePeriodCost(input.daily);
    const averageCompliantExposure = computeAverageCompliantExposure(
        input.dailyHealth
    );
    const shares = computeSelfVsApprovedShares(input.noCoverageDaily);
    const currency =
        input.accountCurrency.trim().toUpperCase() || "USD";

    return {
        periodCost,
        daily: [...input.daily].sort((a, b) =>
            a.snapshotDate.localeCompare(b.snapshotDate)
        ),
        averageCompliantExposure,
        effectiveCost: computeEffectiveCost(
            periodCost,
            averageCompliantExposure
        ),
        accountCurrency: currency,
        selfUnderwrittenCustomerPct: shares.selfUnderwrittenCustomerPct,
        selfUnderwrittenArSharePct: shares.selfUnderwrittenArSharePct,
        approvedCustomerPct: shares.approvedCustomerPct,
        approvedArSharePct: shares.approvedArSharePct,
        deductiblePct: null,
    };
}

async function resolveScopedCustomerIds(
    accountId: number,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Promise<number[] | null> {
    if (!businessUnitFilter || Object.keys(businessUnitFilter).length === 0) {
        return null;
    }
    const rows = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            AND: [businessUnitFilter],
        },
        select: { id: true },
    });
    return rows.map((row) => row.id);
}

async function fetchCptDailyHealthAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptDailyAggregateRow[]> {
    const pendingReviewLiteral = "pending review";
    const insurerDeclinedLiteral = INSURER_DECLINED_REASON.toLowerCase();

    return prisma.$queryRaw<CptDailyAggregateRow[]>`
        SELECT
            t.snapshot_date,
            COALESCE(SUM(t.total_receivables), 0)::float8 AS total_a,
            COALESCE(SUM(t.compliant_exposure), 0)::float8 AS compliant_a,
            COALESCE(SUM(t.at_risk_exposure), 0)::float8 AS at_risk_a,
            COALESCE(
                SUM(
                    CASE
                        WHEN LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) = ${insurerDeclinedLiteral}
                        THEN 0
                        ELSE t.total_receivables
                    END
                ),
                0
            )::float8 AS total_b,
            COALESCE(
                SUM(
                    CASE
                        WHEN LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) = ${insurerDeclinedLiteral}
                        THEN 0
                        ELSE t.compliant_exposure
                    END
                ),
                0
            )::float8 AS compliant_b,
            COALESCE(
                SUM(
                    CASE
                        WHEN LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) = ${insurerDeclinedLiteral}
                        THEN 0
                        ELSE t.at_risk_exposure
                    END
                ),
                0
            )::float8 AS at_risk_b
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.snapshot_date
        ORDER BY t.snapshot_date ASC
    `;
}

async function fetchWithoutPolicyByDate(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        selectedBusinessUnitId?: number | null;
        accessibleBusinessUnitIds?: number[] | null;
        isAdmin?: boolean;
    }
): Promise<Map<string, { amount: number; customerCount: number }>> {
    const map = new Map<string, { amount: number; customerCount: number }>();
    const { fromDateUtc, toDateUtc, policyId } = options;
    const selectedBusinessUnitId = options.selectedBusinessUnitId ?? null;
    const isAdmin = options.isAdmin === true;
    const accessibleBusinessUnitIds = options.accessibleBusinessUnitIds ?? [];

    let rows: WithoutPolicyDayRow[] = [];

    if (isAdmin && selectedBusinessUnitId == null) {
        if (policyId != null) {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT
                    snapshot_date,
                    without_policy_total_amount,
                    without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND policy_id = ${policyId}
                  AND business_unit_id IS NULL
                ORDER BY snapshot_date ASC
            `;
        } else {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT DISTINCT ON (snapshot_date)
                    snapshot_date,
                    without_policy_total_amount,
                    without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND business_unit_id IS NULL
                ORDER BY
                    snapshot_date ASC,
                    (CASE WHEN policy_id IS NULL THEN 1 ELSE 0 END) DESC,
                    policy_id ASC
            `;
        }
    } else if (selectedBusinessUnitId != null) {
        if (policyId != null) {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT
                    snapshot_date,
                    without_policy_total_amount,
                    without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND policy_id = ${policyId}
                  AND business_unit_id = ${selectedBusinessUnitId}
                ORDER BY snapshot_date ASC
            `;
        } else {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT
                    snapshot_date,
                    without_policy_total_amount,
                    without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND policy_id IS NULL
                  AND business_unit_id = ${selectedBusinessUnitId}
                ORDER BY snapshot_date ASC
            `;
        }
    } else if (accessibleBusinessUnitIds.length > 0) {
        if (policyId != null) {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT
                    snapshot_date,
                    SUM(without_policy_total_amount)::float8 AS without_policy_total_amount,
                    SUM(without_policy_customer_count)::float8 AS without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND policy_id = ${policyId}
                  AND business_unit_id IN (${Prisma.join(accessibleBusinessUnitIds)})
                GROUP BY snapshot_date
                ORDER BY snapshot_date ASC
            `;
        } else {
            rows = await prisma.$queryRaw<WithoutPolicyDayRow[]>`
                SELECT
                    snapshot_date,
                    SUM(without_policy_total_amount)::float8 AS without_policy_total_amount,
                    SUM(without_policy_customer_count)::float8 AS without_policy_customer_count
                FROM "CreditDashboardDailySnapshot"
                WHERE account_id = ${accountId}
                  AND snapshot_date >= ${fromDateUtc}::date
                  AND snapshot_date <= ${toDateUtc}::date
                  AND policy_id IS NULL
                  AND business_unit_id IN (${Prisma.join(accessibleBusinessUnitIds)})
                GROUP BY snapshot_date
                ORDER BY snapshot_date ASC
            `;
        }
    }

    for (const row of rows) {
        map.set(normalizeDateString(row.snapshot_date), {
            amount: toNumber(row.without_policy_total_amount),
            customerCount: toNumber(row.without_policy_customer_count),
        });
    }
    return map;
}

function isNoCoverageReasonKey(value: string): value is NoCoverageReasonKey {
    return (NO_COVERAGE_REASON_KEYS as readonly string[]).includes(value);
}

async function fetchCptNoCoverageDayAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptNoCoverageDayRow[]> {
    const pendingReviewLiteral = "pending review";

    return prisma.$queryRaw<CptNoCoverageDayRow[]>`
        SELECT
            t.snapshot_date,
            COUNT(DISTINCT t.customer_id)::float8 AS total_customers,
            COUNT(DISTINCT t.customer_id) FILTER (
                WHERE t.insurance_policy_id IS NULL
                   OR NULLIF(TRIM(t.policy_exclusion_reason), '') IS NOT NULL
            )::float8 AS uncovered_customers,
            COALESCE(
                SUM(t.total_receivables) FILTER (
                    WHERE t.insurance_policy_id IS NULL
                       OR NULLIF(TRIM(t.policy_exclusion_reason), '') IS NOT NULL
                ),
                0
            )::float8 AS uncovered_amount,
            COALESCE(
                SUM(t.total_receivables) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_ar,
            COALESCE(
                SUM(t.terms_breach_amount) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_breach
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.snapshot_date
        ORDER BY t.snapshot_date ASC
    `;
}

async function fetchCptNoCoverageReasonDayAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptNoCoverageReasonDayRow[]> {
    const pendingReviewLiteral = "pending review";

    return prisma.$queryRaw<CptNoCoverageReasonDayRow[]>`
        SELECT
            t.snapshot_date,
            CASE
                WHEN t.insurance_policy_id IS NULL THEN 'no_linked_policy'
                WHEN LOWER(TRIM(t.policy_exclusion_reason)) = 'pending review' THEN 'pending_review'
                WHEN LOWER(TRIM(t.policy_exclusion_reason)) = 'credit hold' THEN 'credit_hold'
                WHEN LOWER(TRIM(t.policy_exclusion_reason)) = 'insurer declined' THEN 'insurer_declined'
                WHEN NULLIF(TRIM(t.policy_exclusion_reason), '') IS NOT NULL THEN 'other'
                ELSE NULL
            END AS reason_key,
            COUNT(DISTINCT t.customer_id)::float8 AS customer_count,
            COALESCE(SUM(t.total_receivables), 0)::float8 AS amount
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
          AND (
            t.insurance_policy_id IS NULL
            OR NULLIF(TRIM(t.policy_exclusion_reason), '') IS NOT NULL
          )
        GROUP BY t.snapshot_date, reason_key
        ORDER BY t.snapshot_date ASC
    `;
}

async function fetchCptApprovedBreachReasonDayAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptBreachReasonDayRow[]> {
    const pendingReviewLiteral = "pending review";

    return prisma.$queryRaw<CptBreachReasonDayRow[]>`
        SELECT
            t.snapshot_date,
            e.key AS reason_key,
            COALESCE(SUM((e.value->>'amount')::float8), 0)::float8 AS amount
        FROM "CustomerPolicyTrend" t
        CROSS JOIN LATERAL jsonb_each(
            CASE
                WHEN jsonb_typeof(COALESCE(t.terms_breach_by_reason, '{}'::jsonb)) = 'object'
                THEN COALESCE(t.terms_breach_by_reason, '{}'::jsonb)
                ELSE '{}'::jsonb
            END
        ) AS e(key, value)
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.snapshot_date, e.key
        ORDER BY t.snapshot_date ASC
    `;
}

function buildNoCoverageDailyPoints(input: {
    cohortRows: CptNoCoverageDayRow[];
    reasonRows: CptNoCoverageReasonDayRow[];
    breachRows: CptBreachReasonDayRow[];
    withoutPolicyByDate: Map<string, { amount: number; customerCount: number }>;
    includeNoPolicyExposure: boolean;
}): PortfolioNoCoverageDailyPoint[] {
    const reasonsByDate = new Map<
        string,
        {
            amountByReason: Partial<Record<NoCoverageReasonKey, number>>;
            customerCountByReason: Partial<Record<NoCoverageReasonKey, number>>;
        }
    >();
    for (const row of input.reasonRows) {
        if (!isNoCoverageReasonKey(row.reason_key)) {
            continue;
        }
        const date = normalizeDateString(row.snapshot_date);
        const bucket =
            reasonsByDate.get(date) ?? emptyNoCoverageReasonMaps();
        bucket.amountByReason[row.reason_key] =
            (bucket.amountByReason[row.reason_key] ?? 0) + toNumber(row.amount);
        bucket.customerCountByReason[row.reason_key] =
            (bucket.customerCountByReason[row.reason_key] ?? 0) +
            toNumber(row.customer_count);
        reasonsByDate.set(date, bucket);
    }

    const breachByDate = new Map<string, Record<string, number>>();
    for (const row of input.breachRows) {
        const date = normalizeDateString(row.snapshot_date);
        const bucket = breachByDate.get(date) ?? {};
        bucket[row.reason_key] =
            (bucket[row.reason_key] ?? 0) + toNumber(row.amount);
        breachByDate.set(date, bucket);
    }

    return input.cohortRows.map((row) => {
        const snapshotDate = normalizeDateString(row.snapshot_date);
        const reasonBucket =
            reasonsByDate.get(snapshotDate) ?? emptyNoCoverageReasonMaps();
        const base: PortfolioNoCoverageDailyPoint = {
            snapshotDate,
            totalCustomerCount: toNumber(row.total_customers),
            uncoveredCustomerCount: toNumber(row.uncovered_customers),
            uncoveredAmount: toNumber(row.uncovered_amount),
            approvedTotalReceivables: toNumber(row.approved_ar),
            approvedTermsBreachAmount: toNumber(row.approved_breach),
            amountByReason: { ...reasonBucket.amountByReason },
            customerCountByReason: { ...reasonBucket.customerCountByReason },
            breachAmountByReason: { ...(breachByDate.get(snapshotDate) ?? {}) },
        };
        return applyWithoutPolicyToNoCoverageDay(
            base,
            input.withoutPolicyByDate.get(snapshotDate),
            input.includeNoPolicyExposure
        );
    });
}

type CptUtilizationDayRow = {
    snapshot_date: Date;
    approved_usage_sum: number | string;
    approved_effective_limit_sum: number | string;
    top_up_weighted_usage_sum: number | string;
    top_up_total_sum: number | string;
    active_top_up_count_sum: number | string;
    customers_with_active_top_up: number | string;
};

type CptTopCustomerRow = {
    customer_id: number;
    usage_amount: number | string;
    effective_usage_pct: number | string | null;
    effective_approved_limit: number | string | null;
    person_name: string | null;
    company_name: string | null;
};

type CptDistributionRow = {
    customer_id: number;
    utilization_pct: number | string;
};

type CptCostDayRow = {
    snapshot_date: Date;
    approved_total_daily_cost: number | string;
};

async function fetchAccountCurrency(accountId: number): Promise<string> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
    });
    const code = account?.currency?.trim();
    return code ? code.toUpperCase() : "USD";
}

async function fetchCptCostDayAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptCostDayRow[]> {
    const pendingReviewLiteral = "pending review";

    return prisma.$queryRaw<CptCostDayRow[]>`
        SELECT
            t.snapshot_date,
            COALESCE(
                SUM(COALESCE(t.total_daily_cost, 0)) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_total_daily_cost
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.snapshot_date
        ORDER BY t.snapshot_date ASC
    `;
}

function buildCostDailyPoints(rows: CptCostDayRow[]): PortfolioCostDailyPoint[] {
    return rows.map((row) => ({
        snapshotDate: normalizeDateString(row.snapshot_date),
        totalDailyCost: toNumber(row.approved_total_daily_cost),
    }));
}

async function fetchCptUtilizationDayAggregates(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<CptUtilizationDayRow[]> {
    const pendingReviewLiteral = "pending review";

    return prisma.$queryRaw<CptUtilizationDayRow[]>`
        SELECT
            t.snapshot_date,
            COALESCE(
                SUM(t.usage_amount) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_usage_sum,
            COALESCE(
                SUM(
                    COALESCE(t.effective_approved_limit, 0)::float8
                ) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_effective_limit_sum,
            COALESCE(
                SUM(
                    CASE
                        WHEN t.insurance_policy_id IS NOT NULL
                         AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                         AND COALESCE(t.top_up_total, 0) > 0
                        THEN COALESCE(t.top_up_total, 0) * (
                            CASE
                                WHEN t.usage_amount > COALESCE(t.approved_limit, 0)::float8
                                THEN GREATEST(
                                    0,
                                    (t.usage_amount - COALESCE(t.approved_limit, 0)::float8)
                                        / COALESCE(t.top_up_total, 0)
                                )
                                ELSE 0
                            END
                        )
                        ELSE 0
                    END
                ),
                0
            )::float8 AS top_up_weighted_usage_sum,
            COALESCE(
                SUM(
                    CASE
                        WHEN t.insurance_policy_id IS NOT NULL
                         AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                         AND COALESCE(t.top_up_total, 0) > 0
                        THEN COALESCE(t.top_up_total, 0)
                        ELSE 0
                    END
                ),
                0
            )::float8 AS top_up_total_sum,
            COALESCE(
                SUM(COALESCE(t.active_top_up_count, 0)),
                0
            )::float8 AS active_top_up_count_sum,
            COUNT(*) FILTER (
                WHERE COALESCE(t.active_top_up_count, 0) > 0
            )::float8 AS customers_with_active_top_up
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        GROUP BY t.snapshot_date
        ORDER BY t.snapshot_date ASC
    `;
}

function buildUtilizationDailyPoints(
    rows: CptUtilizationDayRow[]
): PortfolioUtilizationDailyPoint[] {
    return rows.map((row) => {
        const usageSum = toNumber(row.approved_usage_sum);
        const limitSum = toNumber(row.approved_effective_limit_sum);
        const topUpWeighted = toNumber(row.top_up_weighted_usage_sum);
        const topUpTotal = toNumber(row.top_up_total_sum);
        return {
            snapshotDate: normalizeDateString(row.snapshot_date),
            utilizationPct: computeDailyPortfolioUtilizationPct(
                usageSum,
                limitSum
            ),
            topUpUtilizationPct: computeDailyTopUpUtilizationPct(
                topUpWeighted,
                topUpTotal
            ),
            activeTopUpCountSum: toNumber(row.active_top_up_count_sum),
            customersWithActiveTopUp: toNumber(
                row.customers_with_active_top_up
            ),
        };
    });
}

async function fetchCptTopUtilizationCustomers(
    accountId: number,
    options: {
        asOfDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
        limit?: number;
    }
): Promise<PortfolioUtilizationTopCustomer[]> {
    const pendingReviewLiteral = "pending review";
    const topN = options.limit ?? 10;

    const rows = await prisma.$queryRaw<CptTopCustomerRow[]>`
        SELECT
            t.customer_id,
            t.usage_amount,
            t.effective_usage_pct,
            t.effective_approved_limit,
            p.full_name AS person_name,
            co.name AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date = ${options.asOfDateUtc}::date
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
        ORDER BY
            t.usage_amount DESC,
            COALESCE(
                t.effective_usage_pct,
                CASE
                    WHEN COALESCE(t.effective_approved_limit, 0) > 0
                    THEN (t.usage_amount / COALESCE(t.effective_approved_limit, 0)::float8) * 100
                    ELSE 0
                END
            ) DESC,
            t.customer_id ASC
        LIMIT ${topN}
    `;

    return rows.map((row) => {
        const usageAmount = toNumber(row.usage_amount);
        const effectiveLimit = toNumber(row.effective_approved_limit);
        const storedPct =
            row.effective_usage_pct == null
                ? null
                : toNumber(row.effective_usage_pct);
        const utilizationPct =
            storedPct != null
                ? storedPct
                : effectiveLimit > 0
                  ? (100 * usageAmount) / effectiveLimit
                  : null;
        const customerName =
            row.company_name?.trim() ||
            row.person_name?.trim() ||
            `Customer ${row.customer_id}`;
        return {
            customerId: row.customer_id,
            customerName,
            usageAmount,
            utilizationPct,
        };
    });
}

async function fetchCptUtilizationDistribution(
    accountId: number,
    options: {
        asOfDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<Array<{ utilizationPct: number }>> {
    const pendingReviewLiteral = "pending review";

    const rows = await prisma.$queryRaw<CptDistributionRow[]>`
        SELECT
            t.customer_id,
            CASE
                WHEN t.effective_usage_pct IS NOT NULL THEN t.effective_usage_pct
                ELSE (t.usage_amount / COALESCE(t.effective_approved_limit, 0)::float8) * 100
            END AS utilization_pct
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date = ${options.asOfDateUtc}::date
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND COALESCE(t.effective_approved_limit, 0) > 0
          AND (
            ${options.policyId ?? null}::int IS NULL
            OR t.insurance_policy_id = ${options.policyId ?? null}
          )
          AND (
            ${options.scopedCustomerIds == null}::boolean
            OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
          )
          AND (
            ${options.includeNoPolicyExposure}::boolean
            OR COALESCE(t.total_receivables, 0) <= 0
            OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, ''))) IS DISTINCT FROM ${pendingReviewLiteral}
          )
    `;

    return rows.map((row) => ({
        utilizationPct: toNumber(row.utilization_pct),
    }));
}

/**
 * Portfolio health analytics payload for the selected period and filters.
 * Populates dual Health A/B KPIs, No Coverage, Utilization, and Costs sections.
 */
export async function getCreditPortfolioHealth(
    accountId: number,
    query: CreditPortfolioHealthQuery
): Promise<CreditPortfolioHealthResponse | { error: string }> {
    const parsed = parsePortfolioHealthDateRange(query.from, query.to);
    if ("error" in parsed) {
        return parsed;
    }

    const scopedCustomerIds = await resolveScopedCustomerIds(
        accountId,
        query.businessUnitFilter
    );
    if (scopedCustomerIds?.length === 0) {
        const accountCurrency = await fetchAccountCurrency(accountId);
        return {
            from: parsed.from,
            to: parsed.to,
            daysAvailable: 0,
            daysInRange: parsed.daysInRange,
            portfolioHealth: buildPortfolioHealthSection([], []),
            noCoverage: buildNoCoverageSection([]),
            utilization: emptyUtilizationSection(),
            costs: emptyCostsSection(accountCurrency),
        };
    }

    const cptScope = {
        fromDateUtc: parsed.fromDateUtc,
        toDateUtc: parsed.toDateUtc,
        policyId: query.policyId,
        scopedCustomerIds,
        includeNoPolicyExposure: query.includeNoPolicyExposure,
    };

    const asOfScope = {
        asOfDateUtc: parsed.toDateUtc,
        policyId: query.policyId,
        scopedCustomerIds,
        includeNoPolicyExposure: query.includeNoPolicyExposure,
    };

    const [
        accountCurrency,
        cptRows,
        noCoverageRows,
        reasonRows,
        breachRows,
        utilizationRows,
        costRows,
        topCustomers,
        distributionCustomers,
        withoutPolicyByDate,
    ] = await Promise.all([
        fetchAccountCurrency(accountId),
        fetchCptDailyHealthAggregates(accountId, cptScope),
        fetchCptNoCoverageDayAggregates(accountId, cptScope),
        fetchCptNoCoverageReasonDayAggregates(accountId, cptScope),
        fetchCptApprovedBreachReasonDayAggregates(accountId, cptScope),
        fetchCptUtilizationDayAggregates(accountId, cptScope),
        fetchCptCostDayAggregates(accountId, cptScope),
        fetchCptTopUtilizationCustomers(accountId, asOfScope),
        fetchCptUtilizationDistribution(accountId, asOfScope),
        query.includeNoPolicyExposure
            ? fetchWithoutPolicyByDate(accountId, {
                  fromDateUtc: parsed.fromDateUtc,
                  toDateUtc: parsed.toDateUtc,
                  policyId: query.policyId,
                  selectedBusinessUnitId: query.selectedBusinessUnitId,
                  accessibleBusinessUnitIds: query.accessibleBusinessUnitIds,
                  isAdmin: query.isAdmin,
              })
            : Promise.resolve(
                  new Map<string, { amount: number; customerCount: number }>()
              ),
    ]);

    const withoutPolicyAmountByDate = new Map<string, number>();
    withoutPolicyByDate.forEach((value, date) => {
        withoutPolicyAmountByDate.set(date, value.amount);
    });

    const { dailyA, dailyB } = buildDualDailyHealthSeries(
        cptRows.map((row) => ({
            snapshotDate: normalizeDateString(row.snapshot_date),
            totalA: toNumber(row.total_a),
            compliantA: toNumber(row.compliant_a),
            atRiskA: toNumber(row.at_risk_a),
            totalB: toNumber(row.total_b),
            compliantB: toNumber(row.compliant_b),
            atRiskB: toNumber(row.at_risk_b),
        })),
        withoutPolicyAmountByDate,
        query.includeNoPolicyExposure
    );

    const noCoverageDaily = buildNoCoverageDailyPoints({
        cohortRows: noCoverageRows,
        reasonRows,
        breachRows,
        withoutPolicyByDate,
        includeNoPolicyExposure: query.includeNoPolicyExposure,
    });

    const portfolioHealth = buildPortfolioHealthSection(dailyA, dailyB);
    const utilizationDaily = buildUtilizationDailyPoints(utilizationRows);
    const costDaily = buildCostDailyPoints(costRows);

    return {
        from: parsed.from,
        to: parsed.to,
        daysAvailable: dailyA.length,
        daysInRange: parsed.daysInRange,
        portfolioHealth,
        noCoverage: buildNoCoverageSection(noCoverageDaily),
        utilization: buildUtilizationSection({
            daily: utilizationDaily,
            noCoverageDaily,
            healthAverageA: portfolioHealth.seriesA.averageHealthPct,
            healthAverageB: portfolioHealth.seriesB.averageHealthPct,
            topCustomers,
            distributionCustomers,
        }),
        costs: buildCostsSection({
            daily: costDaily,
            dailyHealth: dailyA,
            noCoverageDaily,
            accountCurrency,
        }),
    };
}

export {
    countInclusiveCalendarDays,
    defaultPortfolioHealthDateRange,
    parsePortfolioHealthDateRange,
} from "./shared/portfolioHealthDateRange";
