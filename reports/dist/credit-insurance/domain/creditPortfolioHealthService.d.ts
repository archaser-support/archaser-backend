import { Prisma } from "@prisma/client";
import type { TermsBreachByReasonSnapshotKey } from "./customerPolicyTrendTermsBreachByReason";
export declare const PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT = 85;
export declare const INSURER_DECLINED_REASON = "Insurer declined";
/** Canonical reason slugs shown even when their period average is 0. */
export declare const NO_COVERAGE_REASON_KEYS: readonly ["pending_review", "credit_hold", "insurer_declined", "no_linked_policy"];
export type CanonicalNoCoverageReasonKey = (typeof NO_COVERAGE_REASON_KEYS)[number];
/**
 * Canonical slug, or the raw `policy_exclusion_reason` text for any
 * non-canonical value (formerly collapsed into a single "other" bucket).
 */
export type NoCoverageReasonKey = CanonicalNoCoverageReasonKey | string;
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
    amountByReason: Partial<Record<string, number>>;
    customerCountByReason: Partial<Record<string, number>>;
    breachAmountByReason: Partial<Record<TermsBreachByReasonSnapshotKey | string, number>>;
};
export type PortfolioNoCoverageReasonItem = {
    reason: string;
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
    /** ISO currency code from the account (e.g. ILS, USD). */
    accountCurrency: string;
};
export declare const UTILIZATION_DISTRIBUTION_BIN_KEYS: readonly ["0_10", "10_20", "20_50", "50_75", "75_plus"];
export type UtilizationDistributionBinKey = (typeof UTILIZATION_DISTRIBUTION_BIN_KEYS)[number];
export type PortfolioUtilizationDailyPoint = {
    snapshotDate: string;
    /** Portfolio effective util % for approved rows; null when limit sum is 0. */
    utilizationPct: number | null;
    /** Size-weighted util % for DCL (self-underwriting) rows; null when DCL limit sum is 0. */
    dclUtilizationPct: number | null;
    /** Size-weighted util % for Named (insurer-approved) rows; null when Named limit sum is 0. */
    namedUtilizationPct: number | null;
    /** Approved DCL customer count that day. */
    dclCustomerCount: number;
    /** Approved Named customer count that day. */
    namedCustomerCount: number;
    /** Sum of total_receivables for approved DCL rows. */
    dclAr: number;
    /** Sum of total_receivables for approved Named rows. */
    namedAr: number;
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
    /**
     * DCL (self-underwriting) share of covered customers (DCL + Named).
     * Uncovered customers are excluded from the denominator.
     */
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    selfUnderwrittenAverageAr: number;
    selfUnderwrittenAverageUtilizationPct: number | null;
    /** Named (insurer-approved) share of covered customers (DCL + Named). */
    approvedCustomerPct: number;
    approvedArSharePct: number;
    approvedAverageAr: number;
    approvedAverageUtilizationPct: number | null;
    averageTopUpUtilizationPct: number | null;
    /** Unique top-ups active on at least one day in the range. */
    periodActiveTopUpCount: number;
    /** Unique customers with an active top-up on at least one day in the range. */
    periodCustomersWithTopUp: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    efficiencyA: number | null;
    /** @deprecated Health B removed from UI; kept null for API compatibility. */
    efficiencyB: number | null;
    distribution: PortfolioUtilizationDistributionBin[];
    distributionCustomerCount: number;
    /** Daily portfolio / DCL / Named utilization for the Utilization chart. */
    daily: PortfolioUtilizationDailyPoint[];
    /** Snapshot day used for top customers and distribution; null when none. */
    asOfDate: string | null;
};
export type PortfolioCostDailyPoint = {
    snapshotDate: string;
    /**
     * @deprecated Sparkline series unused by range-cost Costs tab; kept empty for API compat.
     */
    totalDailyCost: number;
};
export type PortfolioCostMonthlyPoint = {
    month: string;
    /**
     * Calendar-month range cost (Actual Sales + Limit day-slices + top-up
     * amortization), clipped to the selected from/to window.
     */
    totalCost: number;
};
export type PortfolioCostsSection = {
    /**
     * Range Policy cost = Actual Sales (issued × cost %) + Limit
     * ((limit × cost %) / 100 / 365 per day) + amortized top-ups.
     */
    periodCost: number;
    /**
     * @deprecated Always empty; Cost trend sparkline removed from range-cost model.
     */
    daily: PortfolioCostDailyPoint[];
    monthly: PortfolioCostMonthlyPoint[];
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
    /** Mean daily DCL (self-underwriting) AR over the range. */
    selfUnderwrittenAverageAr: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    /** Mean daily Named (insurer-approved) AR over the range. */
    approvedAverageAr: number;
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
/** Latest snapshot YYYY-MM-DD on or before `rangeToYmd`, or null. */
export declare function latestSnapshotYmdOnOrBefore(snapshotYmds: string[], rangeToYmd: string): string | null;
export declare function isInsurerDeclinedReason(reason: unknown): boolean;
/**
 * Calendar-consecutive longest run of days whose value equals `target`.
 * Returns length plus inclusive start/end dates. When multiple equal-length
 * streaks exist, picks the most recent (later end date). Reusable for trough
 * and peak (pass min or max as `target`).
 */
export declare function longestExactValueStreakWindow(points: Array<{
    snapshotDate: string;
    value: number;
}>, target: number): ExactValueStreakWindow;
/** Calendar-consecutive longest run of days whose value equals `target`. */
export declare function longestExactValueStreak(points: Array<{
    snapshotDate: string;
    value: number;
}>, target: number): number;
export declare function buildDailyHealthPoint(input: {
    snapshotDate: string;
    totalReceivables: number;
    compliantExposure: number;
    atRiskExposure: number;
}): PortfolioHealthDailyPoint;
export declare function computePortfolioHealthSeriesMetrics(daily: PortfolioHealthDailyPoint[]): PortfolioHealthSeriesMetrics;
/** Mean of available daily stock amounts per calendar month (YYYY-MM). */
export declare function aggregateDailyHealthToMonthly(daily: PortfolioHealthDailyPoint[]): PortfolioHealthMonthlyPoint[];
/**
 * Build dual daily series from CPT day aggregates, optionally adding
 * historical without-policy AR (increases total + at-risk; compliant unchanged).
 */
export declare function buildDualDailyHealthSeries(rows: Array<{
    snapshotDate: string;
    totalA: number;
    compliantA: number;
    atRiskA: number;
    totalB: number;
    compliantB: number;
    atRiskB: number;
}>, withoutPolicyByDate: Map<string, number>, includeNoPolicyExposure: boolean): {
    dailyA: PortfolioHealthDailyPoint[];
    dailyB: PortfolioHealthDailyPoint[];
};
export declare function buildPortfolioHealthSection(dailyA: PortfolioHealthDailyPoint[], dailyB: PortfolioHealthDailyPoint[]): PortfolioHealthSection;
/** Whether a CPT row belongs in Health A when the no-policy cohort toggle is off. */
export declare function shouldIncludeCptRowInHealthScope(input: {
    includeNoPolicyExposure: boolean;
    exclusionReason: unknown;
    totalReceivables: number;
}): boolean;
export declare function roundToOneDecimal(value: number): number;
/**
 * Map a CPT-style row into a No Coverage reason key, or null when approved.
 * Known exclusion labels become canonical slugs; anything else keeps the
 * trimmed stored text so charts can split former "Other" aggregates.
 */
export declare function classifyNoCoverageReason(input: {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
}): NoCoverageReasonKey | null;
export declare function isApprovedCoverageCustomer(input: {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
}): boolean;
export declare function pickMainViolationReason(amountsByReason: Record<string, number>): {
    reason: string | null;
    sharePct: number;
    totalAmount: number;
};
export declare function emptyNoCoverageReasonMaps(): {
    amountByReason: Partial<Record<string, number>>;
    customerCountByReason: Partial<Record<string, number>>;
};
export declare function applyWithoutPolicyToNoCoverageDay(day: PortfolioNoCoverageDailyPoint, withoutPolicy: {
    customerCount: number;
    amount: number;
} | undefined, includeNoPolicyExposure: boolean): PortfolioNoCoverageDailyPoint;
export declare function buildNoCoverageSection(daily: PortfolioNoCoverageDailyPoint[], accountCurrency?: string): PortfolioNoCoverageSection;
/**
 * Portfolio-level effective utilization for one day.
 * Returns null when the effective-limit denominator is ≤ 0 (caller excludes from averages).
 */
export declare function computeDailyPortfolioUtilizationPct(usageSum: number, effectiveLimitSum: number): number | null;
/**
 * Size-weighted top-up utilization for one day among rows with top_up_total > 0.
 * Uses sum(topUpUsage × topUpTotal) / sum(topUpTotal) × 100.
 */
export declare function computeDailyTopUpUtilizationPct(weightedUsageSum: number, topUpTotalSum: number): number | null;
/** Exclusive utilization distribution bins. Boundaries: [0,10), [10,20), [20,50), [50,75), [75,∞). */
export declare function assignUtilizationDistributionBin(utilizationPct: number): UtilizationDistributionBinKey;
export declare function buildUtilizationDistribution(customers: Array<{
    utilizationPct: number;
}>): {
    bins: PortfolioUtilizationDistributionBin[];
    customerCount: number;
};
export declare function computePolicyEfficiency(healthPct: number, utilizationPct: number): number | null;
/**
 * Footprint shares among covered customers only (DCL + Named).
 * selfUnderwritten* = DCL; approved* = Named.
 * Uncovered customers are excluded from the denominator.
 */
export declare function computeDclVsNamedFootprints(daily: Array<{
    dclCustomerCount: number;
    namedCustomerCount: number;
    dclAr: number;
    namedAr: number;
    dclUtilizationPct: number | null;
    namedUtilizationPct: number | null;
}>): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    selfUnderwrittenAverageAr: number;
    selfUnderwrittenAverageUtilizationPct: number | null;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    approvedAverageAr: number;
    approvedAverageUtilizationPct: number | null;
};
/** @deprecated Prefer computeDclVsNamedFootprints for Utilization/Costs footprints. */
export declare function computeSelfVsApprovedShares(daily: PortfolioNoCoverageDailyPoint[]): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    selfUnderwrittenAverageAr: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    approvedAverageAr: number;
};
export declare function computeUtilizationPeriodMetrics(daily: PortfolioUtilizationDailyPoint[]): {
    averageUtilizationPct: number;
    pctDaysAbove100: number;
    peakUtilizationPct: number;
    peakUtilizationStreakDays: number;
    peakUtilizationStreakStart: string | null;
    peakUtilizationStreakEnd: string | null;
    averageTopUpUtilizationPct: number | null;
};
export declare function emptyUtilizationSection(): PortfolioUtilizationSection;
export declare function buildUtilizationSection(input: {
    daily: PortfolioUtilizationDailyPoint[];
    healthAverageA: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    distributionCustomers: Array<{
        utilizationPct: number;
    }>;
    periodActiveTopUpCount: number;
    periodCustomersWithTopUp: number;
    asOfDate?: string | null;
}): PortfolioUtilizationSection;
/**
 * Effective cost = period cost ÷ average daily compliant exposure.
 * Returns null when average compliant exposure is 0.
 */
export declare function computeEffectiveCost(periodCost: number, averageCompliantExposure: number): number | null;
export declare function computeAverageCompliantExposure(dailyHealth: Array<{
    compliantExposure: number;
}>): number;
export declare function emptyCostsSection(accountCurrency?: string): PortfolioCostsSection;
export declare function buildCostsSection(input: {
    periodCost: number;
    monthly: PortfolioCostMonthlyPoint[];
    dailyHealth: Array<{
        compliantExposure: number;
    }>;
    footprintDaily: Array<{
        dclCustomerCount: number;
        namedCustomerCount: number;
        dclAr: number;
        namedAr: number;
        dclUtilizationPct: number | null;
        namedUtilizationPct: number | null;
    }>;
    accountCurrency: string;
}): PortfolioCostsSection;
/**
 * Portfolio health analytics payload for the selected period and filters.
 * Populates dual Health A/B KPIs, No Coverage, Utilization, and Costs sections.
 */
export declare function getCreditPortfolioHealth(accountId: number, query: CreditPortfolioHealthQuery): Promise<CreditPortfolioHealthResponse | {
    error: string;
}>;
export { countInclusiveCalendarDays, defaultPortfolioHealthDateRange, parsePortfolioHealthDateRange, } from "./shared/portfolioHealthDateRange";
