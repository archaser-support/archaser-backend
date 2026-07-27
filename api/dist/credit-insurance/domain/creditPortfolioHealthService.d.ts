import { Prisma } from "@prisma/client";
import type { TermsBreachByReasonSnapshotKey } from "./customerPolicyTrendTermsBreachByReason";
export declare const PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT = 85;
export declare const INSURER_DECLINED_REASON = "Insurer declined";
export declare const NO_COVERAGE_REASON_KEYS: readonly ["pending_review", "credit_hold", "insurer_declined", "other", "no_linked_policy"];
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
    lowestHealthStreakStart: string | null;
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
    breachAmountByReason: Partial<Record<TermsBreachByReasonSnapshotKey | string, number>>;
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
export declare const UTILIZATION_DISTRIBUTION_BIN_KEYS: readonly ["0_10", "10_20", "20_50", "50_75", "75_plus"];
export type UtilizationDistributionBinKey = (typeof UTILIZATION_DISTRIBUTION_BIN_KEYS)[number];
export type PortfolioUtilizationDailyPoint = {
    snapshotDate: string;
    utilizationPct: number | null;
    topUpUtilizationPct: number | null;
    activeTopUpCountSum: number;
    customersWithActiveTopUp: number;
};
export type PortfolioUtilizationTopCustomer = {
    customerId: number;
    customerName: string;
    usageAmount: number;
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
    totalDailyCost: number;
};
export type PortfolioCostsSection = {
    periodCost: number;
    daily: PortfolioCostDailyPoint[];
    averageCompliantExposure: number;
    effectiveCost: number | null;
    accountCurrency: string;
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
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
export declare function isInsurerDeclinedReason(reason: unknown): boolean;
export declare function longestExactValueStreakWindow(points: Array<{
    snapshotDate: string;
    value: number;
}>, target: number): ExactValueStreakWindow;
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
export declare function aggregateDailyHealthToMonthly(daily: PortfolioHealthDailyPoint[]): PortfolioHealthMonthlyPoint[];
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
export declare function shouldIncludeCptRowInHealthScope(input: {
    includeNoPolicyExposure: boolean;
    exclusionReason: unknown;
    totalReceivables: number;
}): boolean;
export declare function roundToOneDecimal(value: number): number;
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
    amountByReason: Partial<Record<NoCoverageReasonKey, number>>;
    customerCountByReason: Partial<Record<NoCoverageReasonKey, number>>;
};
export declare function applyWithoutPolicyToNoCoverageDay(day: PortfolioNoCoverageDailyPoint, withoutPolicy: {
    customerCount: number;
    amount: number;
} | undefined, includeNoPolicyExposure: boolean): PortfolioNoCoverageDailyPoint;
export declare function buildNoCoverageSection(daily: PortfolioNoCoverageDailyPoint[]): PortfolioNoCoverageSection;
export declare function computeDailyPortfolioUtilizationPct(usageSum: number, effectiveLimitSum: number): number | null;
export declare function computeDailyTopUpUtilizationPct(weightedUsageSum: number, topUpTotalSum: number): number | null;
export declare function assignUtilizationDistributionBin(utilizationPct: number): UtilizationDistributionBinKey;
export declare function buildUtilizationDistribution(customers: Array<{
    utilizationPct: number;
}>): {
    bins: PortfolioUtilizationDistributionBin[];
    customerCount: number;
};
export declare function computePolicyEfficiency(healthPct: number, utilizationPct: number): number | null;
export declare function computeSelfVsApprovedShares(daily: PortfolioNoCoverageDailyPoint[]): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
};
export declare function computeUtilizationPeriodMetrics(daily: PortfolioUtilizationDailyPoint[]): {
    averageUtilizationPct: number;
    pctDaysAbove100: number;
    peakUtilizationPct: number;
    peakUtilizationStreakDays: number;
    peakUtilizationStreakStart: string | null;
    peakUtilizationStreakEnd: string | null;
    averageTopUpUtilizationPct: number | null;
    averageDailyTopUpCount: number;
    averageDailyCustomersWithTopUp: number;
};
export declare function emptyUtilizationSection(): PortfolioUtilizationSection;
export declare function buildUtilizationSection(input: {
    daily: PortfolioUtilizationDailyPoint[];
    noCoverageDaily: PortfolioNoCoverageDailyPoint[];
    healthAverageA: number;
    healthAverageB: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    distributionCustomers: Array<{
        utilizationPct: number;
    }>;
}): PortfolioUtilizationSection;
export declare function computePeriodCost(daily: PortfolioCostDailyPoint[]): number;
export declare function computeEffectiveCost(periodCost: number, averageCompliantExposure: number): number | null;
export declare function computeAverageCompliantExposure(dailyHealth: Array<{
    compliantExposure: number;
}>): number;
export declare function emptyCostsSection(accountCurrency?: string): PortfolioCostsSection;
export declare function buildCostsSection(input: {
    daily: PortfolioCostDailyPoint[];
    dailyHealth: Array<{
        compliantExposure: number;
    }>;
    noCoverageDaily: PortfolioNoCoverageDailyPoint[];
    accountCurrency: string;
}): PortfolioCostsSection;
export declare function getCreditPortfolioHealth(accountId: number, query: CreditPortfolioHealthQuery): Promise<CreditPortfolioHealthResponse | {
    error: string;
}>;
export { countInclusiveCalendarDays, defaultPortfolioHealthDateRange, parsePortfolioHealthDateRange, } from "./shared/portfolioHealthDateRange";
