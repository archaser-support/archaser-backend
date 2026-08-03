import { type UncoveredExposureFields } from "./policyExclusion";
import type { TermsBreachCountByReason } from "./creditInsuranceDashboardService";
export type TermBreachInvoiceRow = {
    outstanding: number;
    inCapacityGap?: boolean;
    capacityGapAmount?: number;
    targetReportingDate?: Date | null;
    reportingBreach?: boolean;
    ctvPaymentTerm?: boolean;
    ctvCustomerOverdueMep?: boolean;
    ctvOutdatedDcl?: boolean;
    ctvInvoiceAfterPolicyEnd?: boolean;
};
export type PolicyRowForUncoveredExposure = {
    insurance_policy_id: number | null;
    is_active?: boolean;
    policy_exclusion_reason?: string | null;
};
export declare function invoiceHasTermsBreachForKpi(invoice: TermBreachInvoiceRow, asOf: Date): boolean;
export declare function sumFlagBasedTermsBreachOutstanding(invoices: TermBreachInvoiceRow[], asOf: Date, options?: {
    excludeCapacityGapInvoices?: boolean;
}): number;
/**
 * Customer-level terms breach: uncovered → full open AR; else flag-based sum.
 */
export declare function resolveCustomerTermsBreachOutstanding(args: {
    uncovered: boolean;
    totalOpenAr: number;
    invoices: TermBreachInvoiceRow[];
    asOf: Date;
    excludeCapacityGapInvoices?: boolean;
}): number;
/** Portfolio Terms Breach card/chart: uncovered customers contribute zero. */
export declare function resolvePortfolioTermsBreachContribution(args: {
    uncovered: boolean;
    flagBasedAmount: number;
}): number;
export declare function resolveUncoveredExposureFromPolicyRows(policyRows: PolicyRowForUncoveredExposure[], policyId?: number | null): boolean;
export declare function uncoveredExposureFieldsFromPolicyRows(policyRows: PolicyRowForUncoveredExposure[], policyId?: number | null): UncoveredExposureFields;
export type PortfolioTermsBreachInvoiceRow = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount?: number | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
};
export declare function aggregatePortfolioTermsBreachFromInvoices(invoices: PortfolioTermsBreachInvoiceRow[]): {
    invoiceCount: number;
    totalAmount: number;
    countByReason: TermsBreachCountByReason;
};
/** Active-policy uncovered customers for notification suppression. */
export declare function fetchUncoveredCustomerIdsForAccount(accountId: number): Promise<Set<number>>;
