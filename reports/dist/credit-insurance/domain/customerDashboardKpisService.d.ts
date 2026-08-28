import { Prisma } from "@prisma/client";
import { type TermsBreachCountByReason } from "./creditInsuranceDashboardService";
import { type RiskExposurePolicySeries } from "./customerPolicyTrendService";
export type CustomerDashboardKpiCards = {
    healthIndex: number;
    atRiskExposure: number;
    policyUsagePct: number | null;
    activePolicyCount: number;
    termsBreachOutstanding: number;
    /** Distinct open Due/Overdue invoices with any terms-breach flag (same membership as outstanding). */
    termsBreachInvoiceCount: number;
    capacityGapAmount: number;
    /** Uninsured exposure: full open AR when excluded from policy, else stored uninsured (0 when outdated DCL). */
    uninsuredAmount: number;
    /** True when the scoped customer policy is excluded from policy. */
    isExcludedFromPolicy: boolean;
    totalAr: number;
    accountCurrency: string | null;
    creditInsuranceSecondaryCurrency?: string | null;
    totalArSecondary?: number | null;
    capacityGapAmountSecondary?: number | null;
    /** Limit/invoice currency for gap secondary line (may differ from creditInsuranceSecondaryCurrency). */
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
/**
 * Customer dashboard KPI formulas (v1) — aligned with credit dashboard / customer GET.
 *
 * - **Health index:** `(compliantExposure / totalAr) × 100`, clamped 0–100; 100 when totalAr ≤ 0.
 *   compliantExposure = totalAr − atRiskExposure (at-risk capped at totalAr).
 * - **At risk exposure:** No policy → totalAr; with policy → `min(totalAr, max(limit driver, terms breach))`.
 *   When the account has top-up policies, limit driver = AR above **effective** limit (approved + top-up);
 *   otherwise stored capacity gap (invoice-summed).
 * - **Capacity gap:** Per insurance policy, sum of open invoice `capacity_gap_amount` synced to
 *   `CustomerPolicy.capacity_gap_amount`. Sticky per-invoice gaps are authoritative — no policy-level
 *   or AR cap on the customer KPI.
 * - **Terms breach:** Sum of outstanding on Due/Overdue breach invoices (same flags as terms report).
 * - **Policy usage %:** `min(999.99, (100 × Σ policy AR) / Σ approved limits)` for active policies in scope.
 * - **Active policies:** Count of active `CustomerPolicy` rows in scope.
 * - Monetary amounts: invoice/policy aggregates in **account base currency** (`Account.currency`).
 */
/**
 * Same formula as portfolio credit dashboard health index, scoped to one customer.
 * healthIndex = (compliantExposure / totalReceivables) × 100
 */
export declare function computeCustomerHealthIndex(totalAr: number, atRiskExposure: number): number;
export type CustomerTermsBreachCountByReasonResult = {
    distribution: TermsBreachCountByReason & {
        other: number;
    };
    /** Distinct invoices matching the terms-breach outstanding membership. */
    invoiceCount: number;
};
export declare function getCustomerTermsBreachCountByReason(accountId: number, customerId: number, policyId?: number): Promise<CustomerTermsBreachCountByReasonResult>;
/** Maps raw breach flag counts to distribution; `other` = invoices not covered by known flags. */
export declare function applyTermsBreachOtherBucket(row: TermsBreachCountByReason & {
    other?: number;
}, totalInvoices: number): TermsBreachCountByReason & {
    other: number;
};
export type PortfolioUsageOptions = {
    /** All-policies view: count policies with open AR even when the row is inactive. */
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
/**
 * Policy / top-up / effective usage % for dashboard cards (sheet 2 formulas).
 * AR and limits must share the same currency (policy limit currency).
 */
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
