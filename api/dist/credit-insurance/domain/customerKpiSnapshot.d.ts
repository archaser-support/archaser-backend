export type CustomerKpiInvoiceRow = {
    outstanding: number;
    limitAssessedAmount: number | null;
    capacityGapAmount: number;
    capacityGapAmountLimit: number;
    inCapacityGap: boolean;
    targetReportingDate: Date | null;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl?: boolean;
    ctvInvoiceAfterPolicyEnd?: boolean;
};
export type CustomerKpiSnapshotInput = {
    openInvoices: CustomerKpiInvoiceRow[];
    approvedLimit: number;
    asOf: Date;
    retainedCapacityGap?: number;
    uncoveredExposure?: boolean;
};
export type CustomerKpiSnapshotResult = {
    totalAr: number;
    termBreach: number;
    capacity: number;
    notInsured: number;
    healthIndex: number;
    retainedCapacityGap: number;
};
export declare function resolveCustomerCapacityGapForKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap: number;
}): {
    capacity: number;
    retainedCapacityGap: number;
};
export declare function computePolicyCapacityGapKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap?: number | null;
}): {
    capacityGapAmount: number;
    retainedCapacityGap: number;
};
export declare function sumTermsBreachOutstandingFromInvoices(invoices: CustomerKpiInvoiceRow[], asOf: Date, options?: {
    excludeCapacityGapInvoices?: boolean;
}): number;
export declare function computeCustomerKpiSnapshotFromInvoices(input: CustomerKpiSnapshotInput): CustomerKpiSnapshotResult;
