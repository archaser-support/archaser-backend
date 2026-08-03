export type CustomerPolicyTrendSnapshotPayloadInput = {
    /** Account base currency for financial KPI amounts. */
    accountCurrency: string | null;
    /** Policy-scoped open AR in account base currency. */
    totalReceivables: number;
    capacityGapAmount: number;
    /** Full terms-breach outstanding (dashboard terms breach card). */
    termsBreachOutstanding: number;
    /** Terms-breach outstanding excluding capacity-gap invoices (at-risk driver). */
    termsBreachOutstandingForAtRisk: number;
    /** Open AR in policy limit currency (usage % formulas). */
    arInLimitCurrency: number;
    approvedLimit: number | null;
    topUpTotal: number | null;
};
export type CustomerPolicyTrendSnapshotFinancialPayload = {
    financialCurrency: string;
    totalReceivables: number;
    healthIndex: number;
    atRiskExposure: number;
    compliantExposure: number;
    capacityGapAmount: number;
    termsBreachAmount: number;
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
};
/**
 * Pure mapper from live policy inputs → {@link CustomerPolicyTrend} financial KPI columns.
 * Formulas match {@link getCustomerDashboardKpis} for a single `insurance_policy_id` scope.
 */
export declare function buildCustomerPolicyTrendSnapshotPayload(input: CustomerPolicyTrendSnapshotPayloadInput): CustomerPolicyTrendSnapshotFinancialPayload;
