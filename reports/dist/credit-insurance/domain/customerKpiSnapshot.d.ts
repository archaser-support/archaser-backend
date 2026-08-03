/** Open invoice row for in-memory / golden KPI snapshot (mirrors persisted breach flags). */
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
    /** When true, terms breach and at-risk use full open AR (uncovered exposure). */
    uncoveredExposure?: boolean;
};
export type CustomerKpiSnapshotResult = {
    totalAr: number;
    termBreach: number;
    capacity: number;
    notInsured: number;
    /** 0–1 unit scale (health index % ÷ 100). */
    healthIndex: number;
    retainedCapacityGap: number;
};
/**
 * Customer-level capacity gap for KPI / at-risk (golden harness + policy sync).
 * Capacity is the sum of sticky per-invoice gaps on still-open invoices — it is
 * not capped at (AR − limit). Gaps clear only when those invoices are paid down.
 */
export declare function resolveCustomerCapacityGapForKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap: number;
}): {
    capacity: number;
    retainedCapacityGap: number;
};
/** Policy sync / dashboard: KPI capacity from invoice gap sum + retained state. */
export declare function computePolicyCapacityGapKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap?: number | null;
}): {
    capacityGapAmount: number;
    retainedCapacityGap: number;
};
/** Same breach-outstanding rules as {@link getCustomerTermsBreachOutstandingSum}. */
export declare function sumTermsBreachOutstandingFromInvoices(invoices: CustomerKpiInvoiceRow[], asOf: Date, options?: {
    excludeCapacityGapInvoices?: boolean;
}): number;
/**
 * End-of-day customer KPI snapshot using production formulas
 * ({@link computeCustomerRiskExposure}, {@link computeCustomerHealthIndex}).
 */
export declare function computeCustomerKpiSnapshotFromInvoices(input: CustomerKpiSnapshotInput): CustomerKpiSnapshotResult;
