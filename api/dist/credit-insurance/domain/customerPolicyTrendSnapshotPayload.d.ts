export type CustomerPolicyTrendSnapshotPayloadInput = {
    accountCurrency: string | null;
    totalReceivables: number;
    capacityGapAmount: number;
    termsBreachOutstanding: number;
    termsBreachOutstandingForAtRisk: number;
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
export declare function buildCustomerPolicyTrendSnapshotPayload(input: CustomerPolicyTrendSnapshotPayloadInput): CustomerPolicyTrendSnapshotFinancialPayload;
