import { Prisma, type cost_calculation_method } from "@prisma/client";

import {
    computeCreditDashboardHealthIndex,
    computeTopUpDailyCostAggregate,
    creditInsurancePrisma as prisma,
    detectStaleArRuns,
    deriveCapacityAndOvershootFromLinkedCptDaySeries,
    fetchLinkedCptCustomerDaySeries,
    summarizePortfolioStaleSlopeVolatility,
    isActiveTopUp,
    isPendingReviewExclusion,
    longestExactValueStreakWindow,
    normalizePolicyExclusionReason,
    type TermsBreachByReasonSnapshotKey,
    UTILIZATION_DISTRIBUTION_BIN_KEYS,
    assignUtilizationDistributionBin,
    type UtilizationDistributionBinKey,
    type HealthMomentumClassification,
} from "@archaser/credit-insurance-domain";
import {
    computeAssessmentYearMultiplier,
    sumAnnualCreditAssessmentCost,
    sumIdleNamedAnnualCreditAssessment,
} from "./annualCreditAssessmentFee";
import { parsePortfolioHealthDateRange } from "./shared/portfolioHealthDateRange";
import {
    computePortfolioRangeCost,
    RANGE_COST_EXCLUDED_INVOICE_STATUSES,
    type PortfolioRangeCostDayRow,
    type PortfolioRangeCostInvoice,
    type PortfolioRangeCostLimitMonthAggregate,
    type PortfolioRangeCostTopUpSlice,
} from "./portfolioRangeCost";

export const PORTFOLIO_HEALTH_BELOW_THRESHOLD_PCT = 85;
export const INSURER_DECLINED_REASON = "Insurer declined";

/** Canonical reason slugs shown even when their period average is 0. */
export const NO_COVERAGE_REASON_KEYS = [
    "pending_review",
    "credit_hold",
    "insurer_declined",
    "no_linked_policy",
] as const;

export type CanonicalNoCoverageReasonKey =
    (typeof NO_COVERAGE_REASON_KEYS)[number];

/**
 * Canonical slug, or the raw `policy_exclusion_reason` text for any
 * non-canonical value (formerly collapsed into a single "other" bucket).
 */
export type NoCoverageReasonKey = CanonicalNoCoverageReasonKey | string;

/** Shared streak helpers — re-exported for existing Portfolio Health callers. */
export {
    longestExactValueStreak,
    type ExactValueStreakWindow,
} from "@archaser/credit-insurance-domain";
export { longestExactValueStreakWindow };


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
    /** True when portfolio total AR was carried forward (identical non-zero). */
    isStaleCarriedForward?: boolean;
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
    /** Chronic over-limit + capacity-gap-days (Bucket 1 KPIs #1 / #4). */
    overLimitGap: PortfolioOverLimitGapSection | null;
    /** Health slope, AR volatility, stale snapshots (Bucket 1 KPIs #5 / #6 / #7). */
    staleSlopeVolatility: PortfolioStaleSlopeVolatilitySection | null;
    /** AR / exposure reconciliation (Bucket 1 KPI #13). */
    exposureReconciliation: PortfolioExposureReconciliationSection | null;
    /** Breach dilution + clean-streak (Bucket 1 KPIs #11 / #12). */
    breachDilutionStreak: PortfolioBreachDilutionStreakSection | null;
};

export type PortfolioNegativeCostPreviewEntry = {
    customerId: number;
    customerName: string;
    snapshotDate: string;
    amount: number;
};

export type PortfolioNegativeCostSection = {
    negativeEntryCount: number;
    negativeEntrySum: number;
    customersAffected: number;
    minMagnitude: number;
    /** Top flagged rows by magnitude (most negative first). */
    previewEntries: PortfolioNegativeCostPreviewEntry[];
    accountCurrency: string;
};

export type PortfolioExposureReconciliationSection = {
    failingRowCount: number;
    maxAbsDelta: number | null;
    customersAffected: number;
    atRiskExceedsTotalRowCount: number;
    atRiskExceedsTotalCustomers: number;
    maxAtRiskExcess: number | null;
    epsilon: number;
    accountCurrency: string;
};

export type PortfolioOverLimitGapSection = {
    customersWithData: number;
    longestStreakDays: number;
    longestStreakStart: string | null;
    longestStreakEnd: string | null;
    longestStreakCustomerId: number | null;
    longestStreakCustomerName: string | null;
    accountCurrency: string;
};

export type PortfolioStaleSlopeVolatilitySection = {
    staleCarriedForwardDayCount: number;
    customersWithStaleDays: number;
    customersWithExtremeMoves: number;
    customersWithData: number;
    portfolioHealthSlope: number | null;
    portfolioHealthClassification: HealthMomentumClassification | null;
    portfolioHealthSlopeSuppressed: boolean;
    portfolioHealthDaysUsed: number;
    portfolioPeakHealth: number | null;
    portfolioPeakDate: string | null;
    portfolioCurrentHealth: number | null;
    portfolioCurrentDate: string | null;
    avgCustomerArSigmaPct: number | null;
    accountCurrency: string;
};

export type PortfolioBreachDilutionStreakSection = {
    customersWithData: number;
    dilutedCustomerCount: number;
    resolvedCustomerCount: number;
    customersWithBreachHistory: number;
    customersCurrentlyInBreach: number;
    customersBreachFree: number;
    customersNeverBreached: number;
    accountCurrency: string;
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
    breachAmountByReason: Partial<
        Record<TermsBreachByReasonSnapshotKey | string, number>
    >;
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

/** Re-export shared bin keys / assigner for API consumers and tests. */
export {
    UTILIZATION_DISTRIBUTION_BIN_KEYS,
    assignUtilizationDistributionBin,
    type UtilizationDistributionBinKey,
};

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
    /** Mean daily usage_amount over available snapshot days in the range. */
    usageAmount: number;
    /** Mean daily total_receivables (open AR) over available snapshot days. */
    openAr: number;
    /**
     * Mean daily effective utilization % over days with a positive effective
     * limit; null when no such day exists.
     */
    utilizationPct: number | null;
};

/** Per-customer utilization overshoot ranking (Bucket 1 KPI #2). */
export type PortfolioUtilizationOvershootCustomer = {
    customerId: number;
    customerName: string;
    avgOvershootPts: number;
    maxOvershootPts: number | null;
    maxOvershootDate: string | null;
    avgUsagePct: number | null;
    peakUsagePct: number | null;
    peakUsageDate: string | null;
    daysWithLimit: number;
    daysAvailable: number;
    /** Available days with utilization strictly above 100%. */
    daysAboveLimit: number;
    /** Longest consecutive available-day streak above 100%. */
    longestAboveLimitDays: number;
    limitCapped: boolean;
};

export type PortfolioUtilizationOvershootSection = {
    customersWithData: number;
    avgOvershootPts: number | null;
    topAvgOvershootPts: number | null;
    topAvgOvershootCustomerId: number | null;
    topAvgOvershootCustomerName: string | null;
    limitCappedCustomerCount: number;
    /** Ranked by avg overshoot DESC (null-limit customers excluded). */
    ranking: PortfolioUtilizationOvershootCustomer[];
};

export type PortfolioUtilizationDistributionBin = {
    bin: UtilizationDistributionBinKey;
    customerCount: number;
    customerPct: number;
    /** Sum of usage_amount for customers in this bin. */
    usageAmount: number;
    /** Share of total usage_amount among included customers (sums ~100%). */
    usagePct: number;
};

/** Per-customer share on a policy as-of snapshot (Bucket 1 KPI #9). */
export type PortfolioPolicyConcentrationCustomer = {
    customerId: number;
    customerName: string;
    openAr: number;
    sharePct: number;
};

export type PortfolioPolicyConcentrationCard = {
    policyId: number;
    policyNumber: string | null;
    asOfDate: string;
    customerCount: number;
    customersWithOpenAr: number;
    totalOpenAr: number;
    top1SharePct: number | null;
    top3SharePct: number | null;
    top1CustomerId: number | null;
    top1CustomerName: string | null;
    alertEligible: boolean;
    concentrationAlert: boolean;
    ranking: PortfolioPolicyConcentrationCustomer[];
};

export type PortfolioConcentrationSection = {
    asOfDate: string | null;
    alertPolicyCount: number;
    policies: PortfolioPolicyConcentrationCard[];
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
    /** Total usage_amount among distribution customers (tooltip / share denom). */
    distributionUsageTotal: number;
    /** ISO currency code from the account (e.g. ILS, USD) for distribution tooltips. */
    accountCurrency: string;
    /** Daily portfolio / DCL / Named utilization for the Utilization chart. */
    daily: PortfolioUtilizationDailyPoint[];
    /** Snapshot day kept for API compatibility; distribution/top customers use the full range. */
    asOfDate: string | null;
    /** Utilization overshoot ranking + limit-capped count (Bucket 1 #2 / #3). */
    overshoot: PortfolioUtilizationOvershootSection | null;
    /** Policy concentration on latest snapshot (Bucket 1 #9). */
    concentration: PortfolioConcentrationSection | null;
    /**
     * Named customers with no positive open AR on any Named day in the range,
     * including named customers with no daily open-AR snapshot in the range.
     * DCL excluded.
     */
    idleNamedCustomerCount: number;
    /**
     * Distinct Named customers: CPT named anytime in the range, plus current
     * NamedPolicy roster customers on those policies (same set as Costs
     * assessment denominator; Σ of per-policy distinct counts).
     */
    namedCustomerCountInRange: number;
    /**
     * Idle named share of named-in-range (0–100). 0 when denominator is 0.
     */
    idleNamedCustomerPct: number;
    /**
     * Σ over policies of (current fee × idle named count × year multiplier).
     * Null fee → $0; count/ratio still populate.
     */
    idleNamedAnnualCreditAssessmentCost: number;
    /**
     * `max(1, ceil(inclusiveDaysInRange / 365))` — same as Costs assessment.
     */
    yearMultiplier: number;
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
    /** Insurance premium for the month (Actual Sales + Limit day-slices). */
    insuranceCost: number;
    /** Registration markup on insurance premiums (not top-ups). */
    registrationFeeCost: number;
    /** Amortized top-up premiums for the month. */
    topUpCost: number;
    /**
     * Calendar-month range cost (insurance + registration + top-ups),
     * clipped to the selected from/to window.
     */
    totalCost: number;
};

export type PortfolioCostsSection = {
    /**
     * Range Policy cost = Actual Sales (issued × cost %) + Limit
     * ((limit × cost %) / 100 / 365 per day) + registration markup on those
     * insurance premiums + amortized top-ups.
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
    /** Anomalous negative daily-cost visibility (Bucket 1 KPI #8). */
    negativeCost: PortfolioNegativeCostSection | null;
    /**
     * Σ over policies of (current Annual Credit Assessment Fee × distinct
     * Named customers named anytime in range × year multiplier). Standalone
     * from Policy cost / monthly / effective cost. Null fee → $0.
     */
    annualCreditAssessmentCost: number;
    /**
     * Sum of per-policy distinct Named customers named anytime in the range
     * (denominator / tooltip for assessment cost).
     */
    namedCustomerCountInRange: number;
    /**
     * `max(1, ceil(inclusiveDaysInRange / 365))` — shared with Utilization.
     */
    yearMultiplier: number;
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

/** Latest snapshot YYYY-MM-DD on or before `rangeToYmd`, or null. */
export function latestSnapshotYmdOnOrBefore(
    snapshotYmds: string[],
    rangeToYmd: string
): string | null {
    let latest: string | null = null;
    for (const ymd of snapshotYmds) {
        if (ymd <= rangeToYmd && (latest == null || ymd > latest)) {
            latest = ymd;
        }
    }
    return latest;
}

export function isInsurerDeclinedReason(reason: unknown): boolean {
    if (reason == null) {
        return false;
    }
    return String(reason).trim().toLowerCase() === INSURER_DECLINED_REASON.toLowerCase();
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
    // Zero-AR days score health 100 by definition and must not inflate
    // period averages, troughs, or "% days below 85".
    const eligible = daily.filter((d) => d.totalReceivables > 0);

    if (eligible.length === 0) {
        return {
            averageHealthPct: 0,
            lowestHealthPct: 0,
            lowestHealthStreakDays: 0,
            lowestHealthStreakStart: null,
            lowestHealthStreakEnd: null,
            pctDaysBelow85: 0,
        };
    }

    const healthValues = eligible.map((d) => d.healthIndex);
    const averageHealthPct =
        healthValues.reduce((sum, v) => sum + v, 0) / healthValues.length;
    const lowestHealthPct = Math.min(...healthValues);
    const troughWindow = longestExactValueStreakWindow(
        eligible.map((d) => ({
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
    dailyB: PortfolioHealthDailyPoint[],
    overLimitGap: PortfolioOverLimitGapSection | null = null,
    staleSlopeVolatility: PortfolioStaleSlopeVolatilitySection | null = null,
    exposureReconciliation: PortfolioExposureReconciliationSection | null = null,
    breachDilutionStreak: PortfolioBreachDilutionStreakSection | null = null
): PortfolioHealthSection {
    return {
        seriesA: computePortfolioHealthSeriesMetrics(dailyA),
        seriesB: computePortfolioHealthSeriesMetrics(dailyB),
        dailyA,
        dailyB,
        monthlyA: aggregateDailyHealthToMonthly(dailyA),
        monthlyB: aggregateDailyHealthToMonthly(dailyB),
        overLimitGap,
        staleSlopeVolatility,
        exposureReconciliation,
        breachDilutionStreak,
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
 * Map a CPT-style row into a No Coverage reason key, or null when approved.
 * Known exclusion labels become canonical slugs; anything else keeps the
 * trimmed stored text so charts can split former "Other" aggregates.
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
    return normalized;
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
    amountByReason: Partial<Record<string, number>>;
    customerCountByReason: Partial<Record<string, number>>;
} {
    return { amountByReason: {}, customerCountByReason: {} };
}

function collectNoCoverageReasonKeys(
    daily: PortfolioNoCoverageDailyPoint[]
): string[] {
    const keys = new Set<string>(NO_COVERAGE_REASON_KEYS);
    for (const day of daily) {
        for (const key of Object.keys(day.amountByReason)) {
            if (key) {
                keys.add(key);
            }
        }
        for (const key of Object.keys(day.customerCountByReason)) {
            if (key) {
                keys.add(key);
            }
        }
    }
    return Array.from(keys);
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
    daily: PortfolioNoCoverageDailyPoint[],
    accountCurrency = "USD"
): PortfolioNoCoverageSection {
    const currency = accountCurrency.trim().toUpperCase() || "USD";
    const reasonKeys = collectNoCoverageReasonKeys(daily);
    if (daily.length === 0) {
        return {
            averageUncoveredCustomerPct: 0,
            averageUncoveredAmount: 0,
            averageUncoveredCustomerCount: 0,
            reasons: reasonKeys.map((reason) => ({
                reason,
                averageAmount: 0,
                averageCustomerCount: 0,
            })),
            averageViolationPct: 0,
            mainViolationReason: null,
            mainViolationReasonSharePct: 0,
            totalBreachAmount: 0,
            accountCurrency: currency,
        };
    }

    const dayCount = daily.length;
    let sumCustomerPct = 0;
    let sumUncoveredAmount = 0;
    let sumUncoveredCustomers = 0;
    let sumViolationPct = 0;
    const sumAmountByReason = Object.fromEntries(
        reasonKeys.map((key) => [key, 0])
    ) as Record<string, number>;
    const sumCustomersByReason = Object.fromEntries(
        reasonKeys.map((key) => [key, 0])
    ) as Record<string, number>;
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

        for (const key of reasonKeys) {
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
        reasons: reasonKeys.map((reason) => ({
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
        accountCurrency: currency,
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

/**
 * Exclusive utilization distribution bins — see
 * `@archaser/credit-insurance-domain` `assignUtilizationDistributionBin`.
 */

export function buildUtilizationDistribution(
    customers: Array<{ utilizationPct: number; usageAmount: number }>
): {
    bins: PortfolioUtilizationDistributionBin[];
    customerCount: number;
    usageTotal: number;
} {
    const counts = Object.fromEntries(
        UTILIZATION_DISTRIBUTION_BIN_KEYS.map((key) => [key, 0])
    ) as Record<UtilizationDistributionBinKey, number>;
    const usageSums = Object.fromEntries(
        UTILIZATION_DISTRIBUTION_BIN_KEYS.map((key) => [key, 0])
    ) as Record<UtilizationDistributionBinKey, number>;

    for (const customer of customers) {
        const bin = assignUtilizationDistributionBin(customer.utilizationPct);
        counts[bin] += 1;
        usageSums[bin] += Math.max(0, Number(customer.usageAmount) || 0);
    }

    const customerCount = customers.length;
    const usageTotal = UTILIZATION_DISTRIBUTION_BIN_KEYS.reduce(
        (sum, bin) => sum + usageSums[bin],
        0
    );
    const bins = UTILIZATION_DISTRIBUTION_BIN_KEYS.map((bin) => ({
        bin,
        customerCount: counts[bin],
        customerPct:
            customerCount > 0 ? (100 * counts[bin]) / customerCount : 0,
        usageAmount: usageSums[bin],
        usagePct: usageTotal > 0 ? (100 * usageSums[bin]) / usageTotal : 0,
    }));

    return { bins, customerCount, usageTotal };
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

/**
 * Footprint shares among covered customers only (DCL + Named).
 * selfUnderwritten* = DCL; approved* = Named.
 * Uncovered customers are excluded from the denominator.
 */
export function computeDclVsNamedFootprints(
    daily: Array<{
        dclCustomerCount: number;
        namedCustomerCount: number;
        dclAr: number;
        namedAr: number;
        dclUtilizationPct: number | null;
        namedUtilizationPct: number | null;
    }>
): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    selfUnderwrittenAverageAr: number;
    selfUnderwrittenAverageUtilizationPct: number | null;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    approvedAverageAr: number;
    approvedAverageUtilizationPct: number | null;
} {
    if (daily.length === 0) {
        return {
            selfUnderwrittenCustomerPct: 0,
            selfUnderwrittenArSharePct: 0,
            selfUnderwrittenAverageAr: 0,
            selfUnderwrittenAverageUtilizationPct: null,
            approvedCustomerPct: 0,
            approvedArSharePct: 0,
            approvedAverageAr: 0,
            approvedAverageUtilizationPct: null,
        };
    }

    let sumDclCustomerPct = 0;
    let sumNamedCustomerPct = 0;
    let customerShareDays = 0;
    let sumDclArShare = 0;
    let sumNamedArShare = 0;
    let arShareDays = 0;
    let sumDclAr = 0;
    let sumNamedAr = 0;
    let sumDclUtil = 0;
    let dclUtilDays = 0;
    let sumNamedUtil = 0;
    let namedUtilDays = 0;

    for (const day of daily) {
        const coveredCustomers = day.dclCustomerCount + day.namedCustomerCount;
        if (coveredCustomers > 0) {
            customerShareDays += 1;
            sumDclCustomerPct += (100 * day.dclCustomerCount) / coveredCustomers;
            sumNamedCustomerPct +=
                (100 * day.namedCustomerCount) / coveredCustomers;
        }

        const coveredAr = day.dclAr + day.namedAr;
        if (coveredAr > 0) {
            arShareDays += 1;
            sumDclArShare += (100 * day.dclAr) / coveredAr;
            sumNamedArShare += (100 * day.namedAr) / coveredAr;
        }

        sumDclAr += day.dclAr;
        sumNamedAr += day.namedAr;

        if (day.dclUtilizationPct != null) {
            dclUtilDays += 1;
            sumDclUtil += day.dclUtilizationPct;
        }
        if (day.namedUtilizationPct != null) {
            namedUtilDays += 1;
            sumNamedUtil += day.namedUtilizationPct;
        }
    }

    const n = daily.length;
    return {
        selfUnderwrittenCustomerPct:
            customerShareDays > 0 ? sumDclCustomerPct / customerShareDays : 0,
        selfUnderwrittenArSharePct:
            arShareDays > 0 ? sumDclArShare / arShareDays : 0,
        selfUnderwrittenAverageAr: sumDclAr / n,
        selfUnderwrittenAverageUtilizationPct:
            dclUtilDays > 0 ? sumDclUtil / dclUtilDays : null,
        approvedCustomerPct:
            customerShareDays > 0 ? sumNamedCustomerPct / customerShareDays : 0,
        approvedArSharePct:
            arShareDays > 0 ? sumNamedArShare / arShareDays : 0,
        approvedAverageAr: sumNamedAr / n,
        approvedAverageUtilizationPct:
            namedUtilDays > 0 ? sumNamedUtil / namedUtilDays : null,
    };
}

/** @deprecated Prefer computeDclVsNamedFootprints for Utilization/Costs footprints. */
export function computeSelfVsApprovedShares(
    daily: PortfolioNoCoverageDailyPoint[]
): {
    selfUnderwrittenCustomerPct: number;
    selfUnderwrittenArSharePct: number;
    selfUnderwrittenAverageAr: number;
    approvedCustomerPct: number;
    approvedArSharePct: number;
    approvedAverageAr: number;
} {
    if (daily.length === 0) {
        return {
            selfUnderwrittenCustomerPct: 0,
            selfUnderwrittenArSharePct: 0,
            selfUnderwrittenAverageAr: 0,
            approvedCustomerPct: 0,
            approvedArSharePct: 0,
            approvedAverageAr: 0,
        };
    }

    let sumSelfCustomerPct = 0;
    let sumApprovedCustomerPct = 0;
    let sumSelfArShare = 0;
    let sumApprovedArShare = 0;
    let sumSelfAr = 0;
    let sumApprovedAr = 0;

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
        sumSelfAr += day.uncoveredAmount;
        sumApprovedAr += day.approvedTotalReceivables;
    }

    const n = daily.length;
    return {
        selfUnderwrittenCustomerPct: sumSelfCustomerPct / n,
        selfUnderwrittenArSharePct: sumSelfArShare / n,
        selfUnderwrittenAverageAr: sumSelfAr / n,
        approvedCustomerPct: sumApprovedCustomerPct / n,
        approvedArSharePct: sumApprovedArShare / n,
        approvedAverageAr: sumApprovedAr / n,
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
} {
    const utilDays = daily.filter(
        (d): d is PortfolioUtilizationDailyPoint & { utilizationPct: number } =>
            d.utilizationPct != null
    );

    if (utilDays.length === 0) {
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
    };
}

export function emptyUtilizationSection(
    accountCurrency = "USD",
    options?: {
        daysInRange?: number;
    }
): PortfolioUtilizationSection {
    const currency = accountCurrency.trim().toUpperCase() || "USD";
    const yearMultiplier = computeAssessmentYearMultiplier(
        options?.daysInRange ?? 1
    );
    return {
        averageUtilizationPct: 0,
        pctDaysAbove100: 0,
        peakUtilizationPct: 0,
        peakUtilizationStreakDays: 0,
        peakUtilizationStreakStart: null,
        peakUtilizationStreakEnd: null,
        selfUnderwrittenCustomerPct: 0,
        selfUnderwrittenArSharePct: 0,
        selfUnderwrittenAverageAr: 0,
        selfUnderwrittenAverageUtilizationPct: null,
        approvedCustomerPct: 0,
        approvedArSharePct: 0,
        approvedAverageAr: 0,
        approvedAverageUtilizationPct: null,
        averageTopUpUtilizationPct: null,
        periodActiveTopUpCount: 0,
        periodCustomersWithTopUp: 0,
        topCustomers: [],
        efficiencyA: null,
        efficiencyB: null,
        distribution: UTILIZATION_DISTRIBUTION_BIN_KEYS.map((bin) => ({
            bin,
            customerCount: 0,
            customerPct: 0,
            usageAmount: 0,
            usagePct: 0,
        })),
        distributionCustomerCount: 0,
        distributionUsageTotal: 0,
        accountCurrency: currency,
        daily: [],
        asOfDate: null,
        overshoot: null,
        concentration: null,
        idleNamedCustomerCount: 0,
        namedCustomerCountInRange: 0,
        idleNamedCustomerPct: 0,
        idleNamedAnnualCreditAssessmentCost: 0,
        yearMultiplier,
    };
}

export function buildUtilizationSection(input: {
    daily: PortfolioUtilizationDailyPoint[];
    healthAverageA: number;
    topCustomers: PortfolioUtilizationTopCustomer[];
    distributionCustomers: Array<{
        utilizationPct: number;
        usageAmount: number;
    }>;
    periodActiveTopUpCount: number;
    periodCustomersWithTopUp: number;
    asOfDate?: string | null;
    accountCurrency?: string;
    overshoot?: PortfolioUtilizationOvershootSection | null;
    concentration?: PortfolioConcentrationSection | null;
    idleNamedCustomerCount?: number;
    namedCustomerCountInRange?: number;
    idleNamedCustomerPct?: number;
    idleNamedAnnualCreditAssessmentCost?: number;
    yearMultiplier?: number;
}): PortfolioUtilizationSection {
    const period = computeUtilizationPeriodMetrics(input.daily);
    const footprints = computeDclVsNamedFootprints(input.daily);
    const distribution = buildUtilizationDistribution(
        input.distributionCustomers
    );
    const currency =
        (input.accountCurrency ?? "USD").trim().toUpperCase() || "USD";

    return {
        averageUtilizationPct: period.averageUtilizationPct,
        pctDaysAbove100: period.pctDaysAbove100,
        peakUtilizationPct: period.peakUtilizationPct,
        peakUtilizationStreakDays: period.peakUtilizationStreakDays,
        peakUtilizationStreakStart: period.peakUtilizationStreakStart,
        peakUtilizationStreakEnd: period.peakUtilizationStreakEnd,
        selfUnderwrittenCustomerPct: footprints.selfUnderwrittenCustomerPct,
        selfUnderwrittenArSharePct: footprints.selfUnderwrittenArSharePct,
        selfUnderwrittenAverageAr: footprints.selfUnderwrittenAverageAr,
        selfUnderwrittenAverageUtilizationPct:
            footprints.selfUnderwrittenAverageUtilizationPct,
        approvedCustomerPct: footprints.approvedCustomerPct,
        approvedArSharePct: footprints.approvedArSharePct,
        approvedAverageAr: footprints.approvedAverageAr,
        approvedAverageUtilizationPct:
            footprints.approvedAverageUtilizationPct,
        averageTopUpUtilizationPct: period.averageTopUpUtilizationPct,
        periodActiveTopUpCount: input.periodActiveTopUpCount,
        periodCustomersWithTopUp: input.periodCustomersWithTopUp,
        topCustomers: input.topCustomers,
        efficiencyA: computePolicyEfficiency(
            input.healthAverageA,
            period.averageUtilizationPct
        ),
        efficiencyB: null,
        distribution: distribution.bins,
        distributionCustomerCount: distribution.customerCount,
        distributionUsageTotal: distribution.usageTotal,
        accountCurrency: currency,
        daily: [...input.daily].sort((a, b) =>
            a.snapshotDate.localeCompare(b.snapshotDate)
        ),
        asOfDate: input.asOfDate ?? null,
        overshoot: input.overshoot ?? null,
        concentration: input.concentration ?? null,
        idleNamedCustomerCount: Number.isFinite(input.idleNamedCustomerCount)
            ? Math.max(0, input.idleNamedCustomerCount as number)
            : 0,
        namedCustomerCountInRange: Number.isFinite(
            input.namedCustomerCountInRange
        )
            ? Math.max(0, input.namedCustomerCountInRange as number)
            : 0,
        idleNamedCustomerPct: Number.isFinite(input.idleNamedCustomerPct)
            ? Math.max(0, input.idleNamedCustomerPct as number)
            : 0,
        idleNamedAnnualCreditAssessmentCost: Number.isFinite(
            input.idleNamedAnnualCreditAssessmentCost
        )
            ? Math.max(0, input.idleNamedAnnualCreditAssessmentCost as number)
            : 0,
        yearMultiplier:
            input.yearMultiplier != null && Number.isFinite(input.yearMultiplier)
                ? Math.max(1, Math.floor(input.yearMultiplier))
                : 1,
    };
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

export function emptyNegativeCostSection(
    accountCurrency = "USD"
): PortfolioNegativeCostSection {
    return {
        negativeEntryCount: 0,
        negativeEntrySum: 0,
        customersAffected: 0,
        minMagnitude: 1,
        previewEntries: [],
        accountCurrency,
    };
}

export function emptyExposureReconciliationSection(
    accountCurrency = "USD"
): PortfolioExposureReconciliationSection {
    return {
        failingRowCount: 0,
        maxAbsDelta: null,
        customersAffected: 0,
        atRiskExceedsTotalRowCount: 0,
        atRiskExceedsTotalCustomers: 0,
        maxAtRiskExcess: null,
        epsilon: 1,
        accountCurrency,
    };
}

export function emptyCostsSection(
    accountCurrency = "USD",
    options?: {
        daysInRange?: number;
    }
): PortfolioCostsSection {
    const yearMultiplier = computeAssessmentYearMultiplier(
        options?.daysInRange ?? 1
    );
    return {
        periodCost: 0,
        daily: [],
        monthly: [],
        averageCompliantExposure: 0,
        effectiveCost: null,
        accountCurrency,
        selfUnderwrittenCustomerPct: 0,
        selfUnderwrittenArSharePct: 0,
        selfUnderwrittenAverageAr: 0,
        approvedCustomerPct: 0,
        approvedArSharePct: 0,
        approvedAverageAr: 0,
        deductiblePct: null,
        negativeCost: emptyNegativeCostSection(accountCurrency),
        annualCreditAssessmentCost: 0,
        namedCustomerCountInRange: 0,
        yearMultiplier,
    };
}

export function buildCostsSection(input: {
    periodCost: number;
    monthly: PortfolioCostMonthlyPoint[];
    dailyHealth: Array<{ compliantExposure: number }>;
    footprintDaily: Array<{
        dclCustomerCount: number;
        namedCustomerCount: number;
        dclAr: number;
        namedAr: number;
        dclUtilizationPct: number | null;
        namedUtilizationPct: number | null;
    }>;
    accountCurrency: string;
    negativeCost?: PortfolioNegativeCostSection | null;
    annualCreditAssessmentCost?: number;
    namedCustomerCountInRange?: number;
    yearMultiplier?: number;
}): PortfolioCostsSection {
    const averageCompliantExposure = computeAverageCompliantExposure(
        input.dailyHealth
    );
    const footprints = computeDclVsNamedFootprints(input.footprintDaily);
    const currency =
        input.accountCurrency.trim().toUpperCase() || "USD";
    const monthly = [...input.monthly].sort((a, b) =>
        a.month.localeCompare(b.month)
    );
    const yearMultiplier =
        input.yearMultiplier != null && Number.isFinite(input.yearMultiplier)
            ? Math.max(1, Math.floor(input.yearMultiplier))
            : 1;

    return {
        periodCost: input.periodCost,
        daily: [],
        monthly,
        averageCompliantExposure,
        effectiveCost: computeEffectiveCost(
            input.periodCost,
            averageCompliantExposure
        ),
        accountCurrency: currency,
        selfUnderwrittenCustomerPct: footprints.selfUnderwrittenCustomerPct,
        selfUnderwrittenArSharePct: footprints.selfUnderwrittenArSharePct,
        selfUnderwrittenAverageAr: footprints.selfUnderwrittenAverageAr,
        approvedCustomerPct: footprints.approvedCustomerPct,
        approvedArSharePct: footprints.approvedArSharePct,
        approvedAverageAr: footprints.approvedAverageAr,
        deductiblePct: null,
        negativeCost:
            input.negativeCost ?? emptyNegativeCostSection(currency),
        annualCreditAssessmentCost: Number.isFinite(
            input.annualCreditAssessmentCost
        )
            ? Math.max(0, input.annualCreditAssessmentCost as number)
            : 0,
        namedCustomerCountInRange: Number.isFinite(
            input.namedCustomerCountInRange
        )
            ? Math.max(0, input.namedCustomerCountInRange as number)
            : 0,
        yearMultiplier,
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

function isCanonicalNoCoverageReasonKey(
    value: string
): value is CanonicalNoCoverageReasonKey {
    return (NO_COVERAGE_REASON_KEYS as readonly string[]).includes(value);
}

/**
 * Normalize a raw CPT reason_key: keep canonical slugs, otherwise keep the
 * trimmed stored exclusion text (case-folded key via classify helpers).
 */
function normalizeNoCoverageReasonKey(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    if (isCanonicalNoCoverageReasonKey(trimmed)) {
        return trimmed;
    }
    // SQL may still emit legacy 'other' from older code paths — keep as-is so
    // UI can label it; new queries return the actual exclusion text instead.
    return trimmed;
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
                WHEN NULLIF(TRIM(t.policy_exclusion_reason), '') IS NOT NULL THEN TRIM(t.policy_exclusion_reason)
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
            amountByReason: Partial<Record<string, number>>;
            customerCountByReason: Partial<Record<string, number>>;
        }
    >();
    for (const row of input.reasonRows) {
        const reasonKey = normalizeNoCoverageReasonKey(row.reason_key);
        if (reasonKey == null) {
            continue;
        }
        const date = normalizeDateString(row.snapshot_date);
        const bucket =
            reasonsByDate.get(date) ?? emptyNoCoverageReasonMaps();
        bucket.amountByReason[reasonKey] =
            (bucket.amountByReason[reasonKey] ?? 0) + toNumber(row.amount);
        bucket.customerCountByReason[reasonKey] =
            (bucket.customerCountByReason[reasonKey] ?? 0) +
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
    dcl_usage_sum: number | string;
    dcl_effective_limit_sum: number | string;
    dcl_customer_count: number | string;
    dcl_ar_sum: number | string;
    named_usage_sum: number | string;
    named_effective_limit_sum: number | string;
    named_customer_count: number | string;
    named_ar_sum: number | string;
    top_up_weighted_usage_sum: number | string;
    top_up_total_sum: number | string;
    active_top_up_count_sum: number | string;
    customers_with_active_top_up: number | string;
};

type CptTopCustomerRow = {
    customer_id: number;
    usage_amount: number | string;
    open_ar: number | string;
    /** Mean daily effective utilization % (null when no positive-limit day). */
    average_utilization_pct: number | string | null;
    person_name: string | null;
    company_name: string | null;
};

type CptDistributionRow = {
    customer_id: number;
    utilization_pct: number | string;
    usage_amount: number | string;
};

type CptCostInputRow = {
    snapshot_date: Date;
    customer_id: number;
    insurance_policy_id: number | null;
    approved_limit: number | string | null;
    usage_amount: number | string | null;
    approved_limit_currency: string | null;
    excluded_from_policy: boolean;
    outdated_dcl: boolean;
    cost_calculation_method: cost_calculation_method | null;
    cost_percent: number | string | null;
    registration_fee_percent: number | string | null;
    policy_exclusion_reason: string | null;
};

type CostTopUpRow = {
    customer_id: number;
    premium: Prisma.Decimal | null;
    premium_currency: string | null;
    start_date: Date;
    end_date: Date;
    cancelled_at: Date | null;
    InsurancePolicy: {
        parent_insurance_policy_id: number | null;
    };
};

type PortfolioRangeCostFetchResult = {
    /** Slim CPT rows for Actual Sales invoice lookups only. */
    dayRows: PortfolioRangeCostDayRow[];
    invoices: PortfolioRangeCostInvoice[];
    topUpSlices: PortfolioRangeCostTopUpSlice[];
    /** Limit (+ Limit registration) costs summed in SQL by YYYY-MM. */
    limitMonthAggregates: PortfolioRangeCostLimitMonthAggregate[];
};

type LimitMonthAggRow = {
    month: string;
    insurance_cost: number | string;
    registration_fee_cost: number | string;
};

type ApprovedTopUpDayRow = {
    snapshot_date: Date;
    customer_id: number;
    insurance_policy_id: number | null;
};

function optionalFiniteNumber(
    value: number | string | Prisma.Decimal | null | undefined
): number | null {
    if (value == null || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function startOfUtcDayFromYmd(ymd: string): Date {
    return new Date(`${ymd}T00:00:00.000Z`);
}

async function fetchAccountCurrency(accountId: number): Promise<string> {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
    });
    const code = account?.currency?.trim();
    return code ? code.toUpperCase() : "USD";
}

/**
 * Portfolio range cost inputs without dumping every CPT row to Node:
 * - Limit day costs aggregated in SQL by month
 * - Slim CPT rows only for Actual Sales invoice dates
 * - Top-up slices only on approved days that overlap an active top-up
 */
async function fetchPortfolioRangeCostInputs(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<PortfolioRangeCostFetchResult> {
    const pendingReviewLiteral = "pending review";
    const limitMethodLiteral = "Limit";

    const topUpWhere: Prisma.CustomerTopUpWhereInput = {
        cancelled_at: null,
        start_date: { lte: options.toDateUtc },
        end_date: { gte: options.fromDateUtc },
        InsurancePolicy: {
            policy_kind: "TopUp",
        },
        Customer: {
            account_id: accountId,
            ...(options.scopedCustomerIds != null
                ? { id: { in: options.scopedCustomerIds } }
                : {}),
        },
    };

    const [limitMonthRows, topUpRows, invoiceRows, approvedTopUpDays] =
        await Promise.all([
            prisma.$queryRaw<LimitMonthAggRow[]>`
                SELECT
                    to_char(t.snapshot_date::timestamp, 'YYYY-MM') AS month,
                    SUM(
                        CASE
                            WHEN t.insurance_policy_id IS NOT NULL
                             AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                             AND NOT COALESCE(t.excluded_from_policy, false)
                             AND NOT COALESCE(t.outdated_dcl, false)
                             AND t.cost_calculation_method::text = ${limitMethodLiteral}
                             AND t.approved_limit IS NOT NULL
                             AND t.cost_percent IS NOT NULL
                             AND t.approved_limit::float8 > 0
                            THEN (t.approved_limit::float8 * t.cost_percent::float8)
                                / 100.0 / 365.0
                            ELSE 0
                        END
                    )::float8 AS insurance_cost,
                    SUM(
                        CASE
                            WHEN t.insurance_policy_id IS NOT NULL
                             AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                             AND NOT COALESCE(t.excluded_from_policy, false)
                             AND NOT COALESCE(t.outdated_dcl, false)
                             AND t.cost_calculation_method::text = ${limitMethodLiteral}
                             AND t.approved_limit IS NOT NULL
                             AND t.cost_percent IS NOT NULL
                             AND t.approved_limit::float8 > 0
                             AND t.registration_fee_percent IS NOT NULL
                            THEN (
                                (t.approved_limit::float8 * t.cost_percent::float8)
                                    / 100.0 / 365.0
                            ) * (t.registration_fee_percent::float8 / 100.0)
                            ELSE 0
                        END
                    )::float8 AS registration_fee_cost
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
                    OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, '')))
                        IS DISTINCT FROM ${pendingReviewLiteral}
                  )
                GROUP BY 1
                ORDER BY 1 ASC
            `,
            prisma.customerTopUp.findMany({
                where: topUpWhere,
                select: {
                    customer_id: true,
                    premium: true,
                    premium_currency: true,
                    start_date: true,
                    end_date: true,
                    cancelled_at: true,
                    InsurancePolicy: {
                        select: {
                            parent_insurance_policy_id: true,
                        },
                    },
                },
            }) as Promise<CostTopUpRow[]>,
            prisma.invoice.findMany({
                where: {
                    account_id: accountId,
                    invoice_date: {
                        gte: options.fromDateUtc,
                        lte: options.toDateUtc,
                    },
                    status: {
                        notIn: [...RANGE_COST_EXCLUDED_INVOICE_STATUSES],
                    },
                    ...(options.policyId != null
                        ? { policy_id: options.policyId }
                        : {}),
                    ...(options.scopedCustomerIds != null
                        ? { customer_id: { in: options.scopedCustomerIds } }
                        : {}),
                },
                select: {
                    invoice_date: true,
                    customer_id: true,
                    amount: true,
                    policy_id: true,
                    status: true,
                },
            }),
            prisma.$queryRaw<ApprovedTopUpDayRow[]>`
                SELECT
                    t.snapshot_date,
                    t.customer_id,
                    t.insurance_policy_id
                FROM "CustomerPolicyTrend" t
                WHERE t.account_id = ${accountId}
                  AND t.snapshot_date >= ${options.fromDateUtc}::date
                  AND t.snapshot_date <= ${options.toDateUtc}::date
                  AND t.insurance_policy_id IS NOT NULL
                  AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                  AND NOT COALESCE(t.excluded_from_policy, false)
                  AND NOT COALESCE(t.outdated_dcl, false)
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
                    OR LOWER(TRIM(COALESCE(t.policy_exclusion_reason, '')))
                        IS DISTINCT FROM ${pendingReviewLiteral}
                  )
                  AND EXISTS (
                    SELECT 1
                    FROM "CustomerTopUp" tu
                    INNER JOIN "InsurancePolicy" tip
                        ON tip.id = tu.insurance_policy_id
                    WHERE tu.customer_id = t.customer_id
                      AND tu.cancelled_at IS NULL
                      AND tip.policy_kind = 'TopUp'
                      AND tu.start_date <= t.snapshot_date
                      AND tu.end_date >= t.snapshot_date
                      AND tip.parent_insurance_policy_id = t.insurance_policy_id
                  )
            `,
        ]);

    const invoices: PortfolioRangeCostInvoice[] = invoiceRows
        .filter((inv) => inv.customer_id != null)
        .map((inv) => ({
            invoiceDate: normalizeDateString(inv.invoice_date),
            customerId: inv.customer_id!,
            amount: toNumber(inv.amount),
            policyId: inv.policy_id,
            status: inv.status,
        }));

    // Slim CPT rows only for Actual Sales invoice dates (last row wins per
    // customer×day — same as the previous Map overwrite behavior).
    let dayRows: PortfolioRangeCostDayRow[] = [];
    if (invoices.length > 0) {
        const invoiceCustomerIds = [
            ...new Set(invoices.map((inv) => inv.customerId)),
        ];
        const invoiceDates = [
            ...new Set(invoices.map((inv) => inv.invoiceDate)),
        ];
        const invoiceDateUtc = invoiceDates.map((ymd) =>
            startOfUtcDayFromYmd(ymd)
        );
        const slimRows = await prisma.$queryRaw<CptCostInputRow[]>`
            SELECT
                t.snapshot_date,
                t.customer_id,
                t.insurance_policy_id,
                t.approved_limit,
                t.usage_amount,
                t.approved_limit_currency,
                t.excluded_from_policy,
                t.outdated_dcl,
                t.cost_calculation_method,
                t.cost_percent,
                t.registration_fee_percent,
                t.policy_exclusion_reason
            FROM "CustomerPolicyTrend" t
            WHERE t.account_id = ${accountId}
              AND t.customer_id = ANY(${invoiceCustomerIds}::int[])
              AND t.snapshot_date IN (${Prisma.join(invoiceDateUtc)})
              AND (
                ${options.policyId ?? null}::int IS NULL
                OR t.insurance_policy_id = ${options.policyId ?? null}
              )
              AND (
                ${options.scopedCustomerIds == null}::boolean
                OR t.customer_id = ANY(${options.scopedCustomerIds ?? []}::int[])
              )
            ORDER BY t.snapshot_date ASC, t.customer_id ASC
        `;
        dayRows = slimRows.map((row) => ({
            snapshotDate: normalizeDateString(row.snapshot_date),
            customerId: row.customer_id,
            insurancePolicyId: row.insurance_policy_id,
            approvedLimit: optionalFiniteNumber(row.approved_limit),
            costCalculationMethod: row.cost_calculation_method,
            costPercent: optionalFiniteNumber(row.cost_percent),
            registrationFeePercent: optionalFiniteNumber(
                row.registration_fee_percent
            ),
            excludedFromPolicy: row.excluded_from_policy,
            outdatedDcl: row.outdated_dcl,
            policyExclusionReason: row.policy_exclusion_reason,
        }));
    }

    const topUpsByCustomerId = new Map<number, CostTopUpRow[]>();
    for (const topUp of topUpRows) {
        const list = topUpsByCustomerId.get(topUp.customer_id) ?? [];
        list.push(topUp);
        topUpsByCustomerId.set(topUp.customer_id, list);
    }

    const topUpSlices: PortfolioRangeCostTopUpSlice[] = [];
    for (const row of approvedTopUpDays) {
        const snapshotDate = normalizeDateString(row.snapshot_date);
        const asOfDate = startOfUtcDayFromYmd(snapshotDate);
        const scopedTopUps = (topUpsByCustomerId.get(row.customer_id) ?? [])
            .filter(
                (topUp) =>
                    isActiveTopUp(
                        {
                            start_date: topUp.start_date,
                            end_date: topUp.end_date,
                            cancelled_at: topUp.cancelled_at,
                        },
                        asOfDate
                    ) &&
                    (row.insurance_policy_id == null ||
                        topUp.InsurancePolicy.parent_insurance_policy_id ===
                            row.insurance_policy_id)
            )
            .map((topUp) => ({
                premium: optionalFiniteNumber(topUp.premium),
                premiumCurrency: topUp.premium_currency,
                startDate: topUp.start_date,
                endDate: topUp.end_date,
                cancelledAt: topUp.cancelled_at,
            }));

        const topUpPart = computeTopUpDailyCostAggregate(
            scopedTopUps,
            asOfDate
        );
        if (topUpPart != null && topUpPart.amount !== 0) {
            topUpSlices.push({
                snapshotDate,
                amount: topUpPart.amount,
            });
        }
    }

    const limitMonthAggregates: PortfolioRangeCostLimitMonthAggregate[] =
        limitMonthRows.map((row) => ({
            month: row.month,
            insuranceCost: toNumber(row.insurance_cost),
            registrationFeeCost: toNumber(row.registration_fee_cost),
        }));

    return { dayRows, invoices, topUpSlices, limitMonthAggregates };
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
    const dclLiteral = "DCL";
    const namedLiteral = "Named";

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
                    COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8
                ) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                ),
                0
            )::float8 AS approved_effective_limit_sum,
            COALESCE(
                SUM(t.usage_amount) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${dclLiteral}
                ),
                0
            )::float8 AS dcl_usage_sum,
            COALESCE(
                SUM(
                    COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8
                ) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${dclLiteral}
                ),
                0
            )::float8 AS dcl_effective_limit_sum,
            COUNT(*) FILTER (
                WHERE t.insurance_policy_id IS NOT NULL
                  AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                  AND t.limit_type::text = ${dclLiteral}
            )::float8 AS dcl_customer_count,
            COALESCE(
                SUM(COALESCE(t.total_receivables, 0)::float8) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${dclLiteral}
                ),
                0
            )::float8 AS dcl_ar_sum,
            COALESCE(
                SUM(t.usage_amount) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${namedLiteral}
                ),
                0
            )::float8 AS named_usage_sum,
            COALESCE(
                SUM(
                    COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8
                ) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${namedLiteral}
                ),
                0
            )::float8 AS named_effective_limit_sum,
            COUNT(*) FILTER (
                WHERE t.insurance_policy_id IS NOT NULL
                  AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                  AND t.limit_type::text = ${namedLiteral}
            )::float8 AS named_customer_count,
            COALESCE(
                SUM(COALESCE(t.total_receivables, 0)::float8) FILTER (
                    WHERE t.insurance_policy_id IS NOT NULL
                      AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
                      AND t.limit_type::text = ${namedLiteral}
                ),
                0
            )::float8 AS named_ar_sum,
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
        const dclUsage = toNumber(row.dcl_usage_sum);
        const dclLimit = toNumber(row.dcl_effective_limit_sum);
        const namedUsage = toNumber(row.named_usage_sum);
        const namedLimit = toNumber(row.named_effective_limit_sum);
        const topUpWeighted = toNumber(row.top_up_weighted_usage_sum);
        const topUpTotal = toNumber(row.top_up_total_sum);
        return {
            snapshotDate: normalizeDateString(row.snapshot_date),
            utilizationPct: computeDailyPortfolioUtilizationPct(
                usageSum,
                limitSum
            ),
            dclUtilizationPct: computeDailyPortfolioUtilizationPct(
                dclUsage,
                dclLimit
            ),
            namedUtilizationPct: computeDailyPortfolioUtilizationPct(
                namedUsage,
                namedLimit
            ),
            dclCustomerCount: toNumber(row.dcl_customer_count),
            namedCustomerCount: toNumber(row.named_customer_count),
            dclAr: toNumber(row.dcl_ar_sum),
            namedAr: toNumber(row.named_ar_sum),
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

async function fetchPeriodTopUpUniques(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
    }
): Promise<{
    periodActiveTopUpCount: number;
    periodCustomersWithTopUp: number;
}> {
    const topUpWhere: Prisma.CustomerTopUpWhereInput = {
        cancelled_at: null,
        start_date: { lte: options.toDateUtc },
        end_date: { gte: options.fromDateUtc },
        InsurancePolicy: {
            policy_kind: "TopUp",
            ...(options.policyId != null
                ? { parent_insurance_policy_id: options.policyId }
                : {}),
        },
        Customer: {
            account_id: accountId,
            ...(options.scopedCustomerIds != null
                ? { id: { in: options.scopedCustomerIds } }
                : {}),
        },
    };

    const rows = await prisma.customerTopUp.findMany({
        where: topUpWhere,
        select: {
            id: true,
            customer_id: true,
        },
    });

    const customerIds = new Set(rows.map((row) => row.customer_id));
    return {
        periodActiveTopUpCount: rows.length,
        periodCustomersWithTopUp: customerIds.size,
    };
}

async function fetchCptTopUtilizationCustomers(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
        limit?: number;
    }
): Promise<PortfolioUtilizationTopCustomer[]> {
    /** Ranked by mean daily open AR (`total_receivables`) DESC. */
    const pendingReviewLiteral = "pending review";
    const topN = options.limit ?? 10;

    const rows = await prisma.$queryRaw<CptTopCustomerRow[]>`
        SELECT
            t.customer_id,
            AVG(COALESCE(t.usage_amount, 0))::float8 AS usage_amount,
            AVG(COALESCE(t.total_receivables, 0))::float8 AS open_ar,
            AVG(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(
                        t.effective_usage_pct,
                        (COALESCE(t.usage_amount, 0)
                            / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8)
                            * 100
                    )
                    ELSE NULL
                END
            )::float8 AS average_utilization_pct,
            MAX(p.full_name) AS person_name,
            MAX(co.name) AS company_name
        FROM "CustomerPolicyTrend" t
        INNER JOIN "Customer" c ON c.id = t.customer_id
        LEFT JOIN "Person" p ON p.id = c.person_id
        LEFT JOIN "Company" co ON co.id = c.company_id
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
        GROUP BY t.customer_id
        ORDER BY
            AVG(COALESCE(t.total_receivables, 0)) DESC,
            AVG(COALESCE(t.usage_amount, 0)) DESC,
            AVG(
                CASE
                    WHEN COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
                    THEN COALESCE(
                        t.effective_usage_pct,
                        (COALESCE(t.usage_amount, 0)
                            / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8)
                            * 100
                    )
                    ELSE NULL
                END
            ) DESC NULLS LAST,
            t.customer_id ASC
        LIMIT ${topN}
    `;

    return rows.map((row) => {
        const usageAmount = toNumber(row.usage_amount);
        const openAr = toNumber(row.open_ar);
        const utilizationPct =
            row.average_utilization_pct == null
                ? null
                : toNumber(row.average_utilization_pct);
        const customerName =
            row.company_name?.trim() ||
            row.person_name?.trim() ||
            `Customer ${row.customer_id}`;
        return {
            customerId: row.customer_id,
            customerName,
            usageAmount,
            openAr,
            utilizationPct,
        };
    });
}

async function fetchCptUtilizationDistribution(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<Array<{ utilizationPct: number; usageAmount: number }>> {
    const pendingReviewLiteral = "pending review";

    const rows = await prisma.$queryRaw<CptDistributionRow[]>`
        SELECT
            t.customer_id,
            AVG(COALESCE(t.usage_amount, 0))::float8 AS usage_amount,
            AVG(
                COALESCE(
                    t.effective_usage_pct,
                    (COALESCE(t.usage_amount, 0)
                        / COALESCE(t.effective_approved_limit, t.approved_limit, 0)::float8)
                        * 100
                )
            )::float8 AS utilization_pct
        FROM "CustomerPolicyTrend" t
        WHERE t.account_id = ${accountId}
          AND t.snapshot_date >= ${options.fromDateUtc}::date
          AND t.snapshot_date <= ${options.toDateUtc}::date
          AND t.insurance_policy_id IS NOT NULL
          AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
          AND COALESCE(t.effective_approved_limit, t.approved_limit, 0) > 0
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
        GROUP BY t.customer_id
    `;

    return rows
        .map((row) => ({
            utilizationPct: toNumber(row.utilization_pct),
            usageAmount: toNumber(row.usage_amount),
        }))
        .filter((row) => Number.isFinite(row.utilizationPct));
}

type NamedInRangeAssessmentRow = {
    insurance_policy_id: number;
    named_customer_count: number | string;
    idle_named_customer_count: number | string;
    annual_credit_assessment_fee: number | string | null;
};

/**
 * Per-policy distinct Named customers for assessment:
 * - CPT Named anytime in the range, plus
 * - current NamedPolicy roster customers (even with no CPT / daily open AR
 *   in the range).
 * Idle = no positive open AR on any Named CPT day in the range (missing CPT
 * counts as idle). Fee is the policy's current live Annual Credit Assessment Fee.
 */
async function fetchNamedInRangeAssessmentByPolicy(
    accountId: number,
    options: {
        fromDateUtc: Date;
        toDateUtc: Date;
        policyId?: number;
        scopedCustomerIds: number[] | null;
        includeNoPolicyExposure: boolean;
    }
): Promise<
    Array<{
        insurancePolicyId: number;
        namedCustomerCount: number;
        idleNamedCustomerCount: number;
        fee: number | null;
    }>
> {
    const pendingReviewLiteral = "pending review";
    const namedLiteral = "Named";

    const rows = await prisma.$queryRaw<NamedInRangeAssessmentRow[]>`
        WITH cpt_named AS (
            SELECT
                t.insurance_policy_id,
                t.customer_id,
                MAX(COALESCE(t.total_receivables, 0)::float8) AS max_open_ar
            FROM "CustomerPolicyTrend" t
            WHERE t.account_id = ${accountId}
              AND t.snapshot_date >= ${options.fromDateUtc}::date
              AND t.snapshot_date <= ${options.toDateUtc}::date
              AND t.insurance_policy_id IS NOT NULL
              AND NULLIF(TRIM(t.policy_exclusion_reason), '') IS NULL
              AND t.limit_type::text = ${namedLiteral}
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
            GROUP BY t.insurance_policy_id, t.customer_id
        ),
        named_policy_roster AS (
            SELECT DISTINCT
                np.insurance_policy_id,
                c.id AS customer_id
            FROM "NamedPolicy" np
            INNER JOIN "InsurancePolicy" p ON p.id = np.insurance_policy_id
            INNER JOIN "Customer" c
                ON c.account_id = p.account_id
               AND c.customer_number = np.customer_number
            WHERE p.account_id = ${accountId}
              AND (
                ${options.policyId ?? null}::int IS NULL
                OR np.insurance_policy_id = ${options.policyId ?? null}
              )
              AND (
                ${options.scopedCustomerIds == null}::boolean
                OR c.id = ANY(${options.scopedCustomerIds ?? []}::int[])
              )
        ),
        all_named AS (
            SELECT insurance_policy_id, customer_id FROM cpt_named
            UNION
            SELECT insurance_policy_id, customer_id FROM named_policy_roster
        )
        SELECT
            a.insurance_policy_id,
            COUNT(*)::float8 AS named_customer_count,
            COUNT(*) FILTER (
                WHERE COALESCE(cpt.max_open_ar, 0) <= 0
            )::float8 AS idle_named_customer_count,
            MAX(p.annual_credit_assessment_fee)::float8
                AS annual_credit_assessment_fee
        FROM all_named a
        INNER JOIN "InsurancePolicy" p ON p.id = a.insurance_policy_id
        LEFT JOIN cpt_named cpt
            ON cpt.insurance_policy_id = a.insurance_policy_id
           AND cpt.customer_id = a.customer_id
        GROUP BY a.insurance_policy_id
    `;

    return rows.map((row) => ({
        insurancePolicyId: row.insurance_policy_id,
        namedCustomerCount: toNumber(row.named_customer_count),
        idleNamedCustomerCount: toNumber(row.idle_named_customer_count),
        fee: optionalFiniteNumber(row.annual_credit_assessment_fee),
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
            portfolioHealth: buildPortfolioHealthSection([], [], {
                customersWithData: 0,
                longestStreakDays: 0,
                longestStreakStart: null,
                longestStreakEnd: null,
                longestStreakCustomerId: null,
                longestStreakCustomerName: null,
                accountCurrency,
            }),
            noCoverage: buildNoCoverageSection([], accountCurrency),
            utilization: emptyUtilizationSection(accountCurrency, {
                daysInRange: parsed.daysInRange,
            }),
            costs: emptyCostsSection(accountCurrency, {
                daysInRange: parsed.daysInRange,
            }),
        };
    }

    const cptScope = {
        fromDateUtc: parsed.fromDateUtc,
        toDateUtc: parsed.toDateUtc,
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
        rangeCostInputs,
        withoutPolicyByDate,
        periodTopUps,
        namedAssessmentByPolicy,
        topCustomers,
        distributionCustomers,
        linkedCptDaySeries,
    ] = await Promise.all([
        fetchAccountCurrency(accountId),
        fetchCptDailyHealthAggregates(accountId, cptScope),
        fetchCptNoCoverageDayAggregates(accountId, cptScope),
        fetchCptNoCoverageReasonDayAggregates(accountId, cptScope),
        fetchCptApprovedBreachReasonDayAggregates(accountId, cptScope),
        fetchCptUtilizationDayAggregates(accountId, cptScope),
        fetchPortfolioRangeCostInputs(accountId, cptScope),
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
        fetchPeriodTopUpUniques(accountId, {
            fromDateUtc: parsed.fromDateUtc,
            toDateUtc: parsed.toDateUtc,
            policyId: query.policyId,
            scopedCustomerIds,
        }),
        fetchNamedInRangeAssessmentByPolicy(accountId, cptScope),
        fetchCptTopUtilizationCustomers(accountId, {
            fromDateUtc: parsed.fromDateUtc,
            toDateUtc: parsed.toDateUtc,
            policyId: query.policyId,
            scopedCustomerIds,
            includeNoPolicyExposure: query.includeNoPolicyExposure,
        }),
        fetchCptUtilizationDistribution(accountId, {
            fromDateUtc: parsed.fromDateUtc,
            toDateUtc: parsed.toDateUtc,
            policyId: query.policyId,
            scopedCustomerIds,
            includeNoPolicyExposure: query.includeNoPolicyExposure,
        }),
        // Capacity-gap + overshoot share one linked CPT day series.
        fetchLinkedCptCustomerDaySeries({
            accountId,
            fromDate: parsed.from,
            toDate: parsed.to,
            policyId: query.policyId,
            scopedCustomerIds,
            includeNoPolicyExposure: query.includeNoPolicyExposure,
        }),
    ]);

    const snapshotYmds = cptRows.map((row) =>
        normalizeDateString(row.snapshot_date)
    );
    const asOfDate = latestSnapshotYmdOnOrBefore(snapshotYmds, parsed.to);
    const { capacity: overLimitGapPeriod, overshoot: overshootPeriod } =
        deriveCapacityAndOvershootFromLinkedCptDaySeries(linkedCptDaySeries);

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

    const slopeVolSummary = summarizePortfolioStaleSlopeVolatility(
        // Portfolio Health UI only shows portfolio-level momentum (from dailyA).
        // Skip per-customer stale/vol over ~100k day rows on every date change.
        [],
        dailyA.map((d) => ({
            snapshotDate: d.snapshotDate,
            healthIndex: d.healthIndex,
            totalReceivables: d.totalReceivables,
        }))
    );

    const portfolioStale = detectStaleArRuns(
        dailyA.map((d) => ({
            snapshotDate: d.snapshotDate,
            totalReceivables: d.totalReceivables,
        }))
    );
    for (const point of dailyA) {
        point.isStaleCarriedForward = portfolioStale.excludeSet.has(
            point.snapshotDate
        );
    }
    for (const point of dailyB) {
        point.isStaleCarriedForward = portfolioStale.excludeSet.has(
            point.snapshotDate
        );
    }

    const noCoverageDaily = buildNoCoverageDailyPoints({
        cohortRows: noCoverageRows,
        reasonRows,
        breachRows,
        withoutPolicyByDate,
        includeNoPolicyExposure: query.includeNoPolicyExposure,
    });

    const portfolioHealth = buildPortfolioHealthSection(
        dailyA,
        dailyB,
        {
            ...overLimitGapPeriod.summary,
            accountCurrency,
        },
        {
            ...slopeVolSummary,
            accountCurrency,
        }
    );
    const utilizationDaily = buildUtilizationDailyPoints(utilizationRows);
    const rangeCost = computePortfolioRangeCost({
        dayRows: rangeCostInputs.dayRows,
        invoices: rangeCostInputs.invoices,
        topUpSlices: rangeCostInputs.topUpSlices,
        policyId: query.policyId,
        limitMonthAggregates: rangeCostInputs.limitMonthAggregates,
    });

    const yearMultiplier = computeAssessmentYearMultiplier(parsed.daysInRange);
    const assessmentByPolicy = namedAssessmentByPolicy.map((row) => ({
        fee: row.fee,
        namedCustomerCount: row.namedCustomerCount,
        idleNamedCustomerCount: row.idleNamedCustomerCount,
    }));

    return {
        from: parsed.from,
        to: parsed.to,
        daysAvailable: dailyA.length,
        daysInRange: parsed.daysInRange,
        portfolioHealth,
        noCoverage: buildNoCoverageSection(noCoverageDaily, accountCurrency),
        utilization: buildUtilizationSection({
            daily: utilizationDaily,
            healthAverageA: portfolioHealth.seriesA.averageHealthPct,
            topCustomers,
            distributionCustomers,
            periodActiveTopUpCount: periodTopUps.periodActiveTopUpCount,
            periodCustomersWithTopUp: periodTopUps.periodCustomersWithTopUp,
            asOfDate,
            accountCurrency,
            overshoot: {
                customersWithData: overshootPeriod.summary.customersWithData,
                avgOvershootPts: overshootPeriod.summary.avgOvershootPts,
                topAvgOvershootPts: overshootPeriod.summary.topAvgOvershootPts,
                topAvgOvershootCustomerId:
                    overshootPeriod.summary.topAvgOvershootCustomerId,
                topAvgOvershootCustomerName:
                    overshootPeriod.summary.topAvgOvershootCustomerName,
                limitCappedCustomerCount:
                    overshootPeriod.summary.limitCappedCustomerCount,
                ranking: overshootPeriod.overshootRanking.map((r) => ({
                    customerId: r.customerId,
                    customerName: r.customerName,
                    avgOvershootPts: r.avgOvershootPts ?? 0,
                    maxOvershootPts: r.maxOvershootPts,
                    maxOvershootDate: r.maxOvershootDate,
                    avgUsagePct: r.avgUsagePct,
                    peakUsagePct: r.peakUsagePct,
                    peakUsageDate: r.peakUsageDate,
                    daysWithLimit: r.daysWithLimit,
                    daysAvailable: r.daysAvailable,
                    daysAboveLimit: r.daysAboveLimit,
                    longestAboveLimitDays: r.longestAboveLimitStreak.days,
                    limitCapped: r.limitCapped.limitCapped,
                })),
            },
            ...sumIdleNamedAnnualCreditAssessment(
                assessmentByPolicy,
                yearMultiplier
            ),
        }),
        costs: buildCostsSection({
            periodCost: rangeCost.periodCost,
            monthly: rangeCost.monthly,
            dailyHealth: dailyA,
            footprintDaily: utilizationDaily,
            accountCurrency,
            ...sumAnnualCreditAssessmentCost(
                assessmentByPolicy.map((row) => ({
                    fee: row.fee,
                    namedCustomerCount: row.namedCustomerCount,
                })),
                yearMultiplier
            ),
        }),
    };
}

export {
    countInclusiveCalendarDays,
    defaultPortfolioHealthDateRange,
    parsePortfolioHealthDateRange,
} from "./shared/portfolioHealthDateRange";
