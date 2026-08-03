import { cost_calculation_method, Prisma } from "@prisma/client";
export type RiskExposurePolicySeries = {
    policyId: number;
    policyLabel: string;
    series: Array<{
        snapshotDate: string;
        amount: number;
    }>;
};
export type CustomerPolicyTrendTopRow = {
    customerId: number;
    customerName: string;
    policyNumber: string | null;
    approvedLimit: number | null;
    topUpTotal: number | null;
    effectiveApprovedLimit: number | null;
    usageAmount: number;
    /** Policy limit usage % (sheet 2; capped at 100% when top-up applies). */
    policyUsagePct: number | null;
    /** Top-up pool usage % when AR exceeds approved limit. */
    topUpUsagePct: number | null;
    /** AR / effective limit × 100. */
    effectiveUsagePct: number | null;
    /** Bar segment widths (% of effective limit, or policy-only when no top-up). */
    barPolicyPct: number;
    barTopUpPct: number;
    barOverPct: number;
    /** Primary bar length / legacy field: effective usage when top-up exists, else policy usage. */
    usagePct: number | null;
};
export type CustomerPolicyUsageTrendResponse = {
    snapshotDate: string | null;
    hasTopUpPolicies: boolean;
    topCustomers: CustomerPolicyTrendTopRow[];
};
export type CustomerPolicyDailyCostChangeFields = {
    policyDailyCostChange: number | null;
    policyCostCurrency: string | null;
    topUpDailyCostChange: number | null;
    topUpCostCurrency: string | null;
    totalDailyCostChange: number | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: number | null;
};
export type CustomerPolicyDailyCostKpiMetadata = {
    priorSnapshotDate: string | null;
    gapFillDaysApplied?: number;
};
export type CustomerPolicyDailyCostKpiPayload = CustomerPolicyDailyCostChangeFields & CustomerPolicyDailyCostKpiMetadata;
export type CustomerPolicyCustomerTrendPoint = {
    snapshotDate: string;
    usageAmount: number;
    approvedLimit: number | null;
    usagePct: number | null;
} & CustomerPolicyDailyCostChangeFields;
export type CustomerPolicyCustomerTrendLatestPoint = CustomerPolicyCustomerTrendPoint & CustomerPolicyDailyCostKpiMetadata;
export type CustomerPolicyTrendRowForPoint = {
    snapshot_date: Date;
    usage_amount: number;
    approved_limit: Prisma.Decimal | null;
    usage_pct?: number | null;
    effective_usage_pct?: number | null;
    effective_approved_limit?: Prisma.Decimal | null;
    policy_daily_cost?: Prisma.Decimal | null;
    policy_cost_currency?: string | null;
    top_up_daily_cost?: Prisma.Decimal | null;
    top_up_cost_currency?: string | null;
    total_daily_cost?: Prisma.Decimal | null;
    cost_calculation_method?: cost_calculation_method | null;
    cost_percent?: Prisma.Decimal | null;
};
export type CustomerPolicyCustomerTrendResponse = {
    customerId: number;
    policyId: number | null;
    fromDate: string | null;
    toDate: string | null;
    latest: CustomerPolicyCustomerTrendLatestPoint | null;
    series: CustomerPolicyCustomerTrendPoint[];
};
export type CustomerPolicyPortfolioTrendPoint = {
    snapshotDate: string;
    totalUsageAmount: number;
    totalApprovedLimit: number;
    portfolioUsagePct: number | null;
    nearLimitCustomerCount: number;
    overLimitCustomerCount: number;
};
export type CustomerPolicyPortfolioTrendResponse = {
    fromDate: string | null;
    toDate: string | null;
    series: CustomerPolicyPortfolioTrendPoint[];
};
/**
 * Public API `usagePct` source: prefer snapshotted effective usage %, then legacy
 * `usage_pct`, then recompute from AR and limit columns on the trend row.
 */
export declare function resolveTrendRowUsagePct(row: {
    effective_usage_pct?: number | null;
    usage_pct?: number | null;
    usage_amount?: number;
    approved_limit?: Prisma.Decimal | null;
    effective_approved_limit?: Prisma.Decimal | null;
}): number | null;
export declare function mapDailyCostFieldsFromTrendRow(row: Pick<CustomerPolicyTrendRowForPoint, "policy_daily_cost" | "policy_cost_currency" | "top_up_daily_cost" | "top_up_cost_currency" | "total_daily_cost" | "cost_calculation_method" | "cost_percent">): CustomerPolicyDailyCostChangeFields;
/**
 * Prior snapshot used as the delta baseline for {@link snapshotDate}.
 * Prefers the prior UTC calendar day when present in the series; otherwise the latest earlier date.
 */
export declare function resolvePriorSnapshotDateFromOrderedDates(orderedSnapshotDatesAsc: string[], snapshotDate: string): string | null;
/**
 * Infer how many UTC gap-fill days the account cron likely applied before today,
 * from distinct snapshot dates strictly before today.
 */
export declare function inferGapFillDaysAppliedFromRecentDates(snapshotDatesBeforeTodayAsc: Date[], todayUtc: Date): number;
export declare function mapCustomerPolicyTrendRowToPoint(row: CustomerPolicyTrendRowForPoint): CustomerPolicyCustomerTrendPoint;
export declare function getCustomerDailyCostFromTrend(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<CustomerPolicyDailyCostKpiPayload | null>;
/** Stacked bar segments for top-customer usage chart (policy / top-up / over effective). */
export declare function computeCustomerUsageBarSegments(args: {
    ar: number;
    approvedLimit: number | null;
    topUpTotal: number | null;
    hasTopUpPolicies: boolean;
}): {
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
    barPolicyPct: number;
    barTopUpPct: number;
    barOverPct: number;
    usagePct: number | null;
};
/**
 * Upsert today's {@link CustomerPolicyTrend} rows for one account (live open AR + top-up).
 */
export declare function syncCustomerPolicyTrendSnapshotForAccount(accountId: number, options?: {
    policyId?: number;
    snapshotDate?: Date;
}): Promise<number>;
/**
 * Upsert one daily row per customer with an active {@link CustomerPolicy} on credit-insurance accounts.
 */
export type CustomerPolicyTrendSnapshotRunResult = {
    accountsProcessed: number;
    rowsUpserted: number;
    gapFillWarnings: Array<{
        accountId: number;
        gapDays: number;
        gapFillDaysApplied: number;
    }>;
};
export declare function takeCustomerPolicyTrendSnapshots(): Promise<CustomerPolicyTrendSnapshotRunResult>;
/**
 * Top N customers by current AR / usage amount on the latest snapshot day.
 * Includes approved limit and usage % so the UI can compare both amount and percent.
 */
export declare function getCustomerPolicyUsageTrend(accountId: number, options?: {
    policyId?: number;
    limit?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
}): Promise<CustomerPolicyUsageTrendResponse>;
export declare function getCustomerPolicyTrendForCustomer(accountId: number, customerId: number, options?: {
    policyId?: number;
    days?: number;
}): Promise<CustomerPolicyCustomerTrendResponse>;
/**
 * Daily portfolio limit usage from {@link CustomerPolicyTrend} (sum AR vs sum limits per day).
 */
export declare function getCustomerPolicyPortfolioTrend(accountId: number, options?: {
    policyId?: number;
    days?: number;
}): Promise<CustomerPolicyPortfolioTrendResponse>;
/**
 * Per-policy risk exposure amount over time from {@link CustomerPolicyTrend} snapshots.
 * Amount at each point = min(usage AR, capacity gap from limit + terms breach outstanding).
 */
export declare function getCustomerRiskExposureAmountTrendByPolicy(accountId: number, customerId: number, options?: {
    policyId?: number;
    days?: number;
    termsBreachOutstanding?: number;
}): Promise<RiskExposurePolicySeries[]>;
