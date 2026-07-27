import { Prisma } from "@prisma/client";
import { type TermsBreachCountByReason } from "./creditInsuranceDashboardService";
import { type RiskExposurePolicySeries } from "./customerPolicyTrendService";
export type CustomerDashboardKpiCards = {
    healthIndex: number;
    atRiskExposure: number;
    policyUsagePct: number | null;
    activePolicyCount: number;
    termsBreachOutstanding: number;
    capacityGapAmount: number;
    uninsuredAmount: number;
    isExcludedFromPolicy: boolean;
    totalAr: number;
    accountCurrency: string | null;
    creditInsuranceSecondaryCurrency?: string | null;
    totalArSecondary?: number | null;
    capacityGapAmountSecondary?: number | null;
    capacityGapLimitCurrency?: string | null;
    uninsuredAmountSecondary?: number | null;
    termsBreachOutstandingSecondary?: number | null;
    atRiskExposureSecondary?: number | null;
    topUpTotal?: number | null;
    topUpUsagePct?: number | null;
    effectiveLimit?: number | null;
    effectiveUsagePct?: number | null;
};
export type { RiskExposurePolicySeries } from "./customerPolicyTrendService";
export type CustomerDashboardKpisResponse = {
    customerId: number;
    policyId: number | null;
    cards: CustomerDashboardKpiCards;
    riskExposureByPolicy: RiskExposurePolicySeries[];
    termsBreachReasonDistribution: TermsBreachCountByReason & {
        other: number;
    };
};
export declare function computeCustomerHealthIndex(totalAr: number, atRiskExposure: number): number;
export declare function getCustomerTermsBreachCountByReason(accountId: number, customerId: number, policyId?: number): Promise<TermsBreachCountByReason & {
    other: number;
}>;
export declare function applyTermsBreachOtherBucket(row: TermsBreachCountByReason & {
    other?: number;
}, totalInvoices: number): TermsBreachCountByReason & {
    other: number;
};
export type PortfolioUsageOptions = {
    includeInactiveWithExposure?: boolean;
};
export declare function computePortfolioUsagePct(policies: Array<{
    insurance_policy_id: number | null;
    approved_limit: Prisma.Decimal | null;
    is_active: boolean;
    approved_limit_currency?: string | null;
}>, openArByPolicy: Map<number, number>, accountCurrency: string | null, options?: PortfolioUsageOptions): Promise<number | null>;
export type PolicyUsageRowInput = {
    ar: number;
    approvedLimit: number;
    topUpTotal: number;
};
export declare function aggregatePolicyUsageFromRows(rows: PolicyUsageRowInput[]): {
    policyUsagePct: number | null;
    topUpTotal: number | null;
    topUpUsagePct: number | null;
    effectiveLimit: number | null;
    effectiveUsagePct: number | null;
};
export declare function getCustomerDashboardKpis(accountId: number, customerId: number, options?: {
    policyId?: number;
    days?: number;
}): Promise<CustomerDashboardKpisResponse>;
