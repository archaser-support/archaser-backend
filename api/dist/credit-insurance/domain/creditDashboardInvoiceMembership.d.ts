import type { Prisma } from "@prisma/client";
export declare const TERMS_BREACH_REASON_FIELDS: readonly ["reporting_breach", "ctv_payment_term", "ctv_customer_overdue_mep", "ctv_outdated_dcl", "ctv_invoice_after_policy_end"];
export type TermsBreachReasonField = (typeof TERMS_BREACH_REASON_FIELDS)[number];
export declare function isTermsBreachReasonField(value: string | null | undefined): value is TermsBreachReasonField;
export interface CreditInvoiceMembershipOptions {
    policyId?: number;
    customerId?: number;
    termsBreachReason?: string | null;
    termsOverdueOnly?: boolean;
    windowDays?: number;
}
export declare function termsBreachMembershipWhere(accountId: number, options?: CreditInvoiceMembershipOptions): Prisma.InvoiceWhereInput;
export declare function reportingCountdownMembershipWhere(accountId: number, windowDays: number, options?: Pick<CreditInvoiceMembershipOptions, "policyId" | "customerId">): Prisma.InvoiceWhereInput;
export declare function reportedInvoicesMembershipWhere(accountId: number, options?: Pick<CreditInvoiceMembershipOptions, "policyId" | "customerId">): Prisma.InvoiceWhereInput;
export declare function resolveReportingCountdownWindowDays(accountId: number): Promise<number>;
