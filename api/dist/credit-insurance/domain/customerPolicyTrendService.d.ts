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
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
    barPolicyPct: number;
    barTopUpPct: number;
    barOverPct: number;
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
export declare function resolveTrendRowUsagePct(row: {
    effective_usage_pct?: number | null;
    usage_pct?: number | null;
    usage_amount?: number;
    approved_limit?: Prisma.Decimal | null;
    effective_approved_limit?: Prisma.Decimal | null;
}): number | null;
export declare function mapDailyCostFieldsFromTrendRow(row: Pick<CustomerPolicyTrendRowForPoint, "policy_daily_cost" | "policy_cost_currency" | "top_up_daily_cost" | "top_up_cost_currency" | "total_daily_cost" | "cost_calculation_method" | "cost_percent">): CustomerPolicyDailyCostChangeFields;
export declare function resolvePriorSnapshotDateFromOrderedDates(orderedSnapshotDatesAsc: string[], snapshotDate: string): string | null;
export declare function inferGapFillDaysAppliedFromRecentDates(snapshotDatesBeforeTodayAsc: Date[], todayUtc: Date): number;
export declare function mapCustomerPolicyTrendRowToPoint(row: CustomerPolicyTrendRowForPoint): CustomerPolicyCustomerTrendPoint;
export declare function getCustomerDailyCostFromTrend(accountId: number, customerId: number, options?: {
    policyId?: number;
}): Promise<CustomerPolicyDailyCostKpiPayload | null>;
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
export declare function syncCustomerPolicyTrendSnapshotForAccount(accountId: number, options?: {
    policyId?: number;
    snapshotDate?: Date;
}): Promise<number>;
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
export declare function getCustomerPolicyUsageTrend(accountId: number, options?: {
    policyId?: number;
    limit?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
}): Promise<CustomerPolicyUsageTrendResponse>;
export declare function getCustomerPolicyTrendForCustomer(accountId: number, customerId: number, options?: {
    policyId?: number;
    days?: number;
}): Promise<CustomerPolicyCustomerTrendResponse>;
export declare function getCustomerPolicyPortfolioTrend(accountId: number, options?: {
    policyId?: number;
    days?: number;
}): Promise<CustomerPolicyPortfolioTrendResponse>;
export declare function getCustomerRiskExposureAmountTrendByPolicy(accountId: number, customerId: number, options?: {
    policyId?: number;
    days?: number;
    termsBreachOutstanding?: number;
}): Promise<RiskExposurePolicySeries[]>;
