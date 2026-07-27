import { Prisma } from "@prisma/client";
import type { TermsBreachCountByReason } from "./creditInsuranceDashboardService";
export type TermsBreachReasonSnapshot = {
    count: number;
    amount: number;
};
export type TermsBreachByReasonSnapshotKey = keyof (TermsBreachCountByReason & {
    other: number;
});
export type TermsBreachByReasonSnapshot = Partial<Record<TermsBreachByReasonSnapshotKey, TermsBreachReasonSnapshot>>;
export type TermsBreachInvoiceForAggregation = {
    policyId: number | null;
    outstanding: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
};
export declare function invoiceOutstandingInAccountCurrency(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number;
export declare function invoiceMatchesPolicyScope(policyId: number | null, scope: number | null | undefined): boolean;
export declare function invoiceHasTermsBreachFlag(invoice: Pick<TermsBreachInvoiceForAggregation, "reportingBreach" | "ctvPaymentTerm" | "ctvCustomerOverdueMep" | "ctvOutdatedDcl" | "ctvInvoiceAfterPolicyEnd">): boolean;
export declare function aggregateTermsBreachByReasonFromInvoices(invoices: TermsBreachInvoiceForAggregation[], policyScope?: number | null): TermsBreachByReasonSnapshot;
export type CustomerTermsBreachByReasonSnapshotResult = {
    snapshot: TermsBreachByReasonSnapshot;
    invoiceCount: number;
};
export declare function getCustomerTermsBreachByReasonSnapshot(accountId: number, customerId: number, policyId: number | null): Promise<CustomerTermsBreachByReasonSnapshotResult>;
export declare function termsBreachByReasonSnapshotToJson(snapshot: TermsBreachByReasonSnapshot): Prisma.InputJsonValue;
