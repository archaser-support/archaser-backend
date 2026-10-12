/**
 * Invoice-grain membership where fragments for credit dashboard ViewBased execute.
 * Mirrors getTermsBreachReport / getReportingCountdownOpenReport / getReportedInvoicesReport
 * (without search text — execute search handles that; without BU — execute applies it).
 */

import type { Prisma } from "@prisma/client";
import { invoice_status } from "@prisma/client";
import { addDays, startOfDay } from "date-fns";

import { prisma } from "../domain-db";

/** Shared OR of invoice terms-breach flags (ViewBased + leaves reports). */
export const TERMS_BREACH_OR: Prisma.InvoiceWhereInput[] = [
    { reporting_breach: true },
    { ctv_payment_term: true },
    { ctv_customer_overdue_mep: true },
    { ctv_outdated_dcl: true },
    { ctv_invoice_after_policy_end: true },
];

export const TERMS_BREACH_REASON_FIELDS = [
    "reporting_breach",
    "ctv_payment_term",
    "ctv_customer_overdue_mep",
    "ctv_outdated_dcl",
    "ctv_invoice_after_policy_end",
] as const;

export type TermsBreachReasonField =
    (typeof TERMS_BREACH_REASON_FIELDS)[number];

/** Alias kept for leaves / public API callers. */
export type TermsBreachReasonFilter = TermsBreachReasonField;

export function isTermsBreachReasonField(
    value: string | null | undefined
): value is TermsBreachReasonField {
    return (
        !!value &&
        (TERMS_BREACH_REASON_FIELDS as readonly string[]).includes(value)
    );
}

/** Alias kept for leaves / public API callers. */
export function isTermsBreachReasonFilter(
    value: string | null | undefined
): value is TermsBreachReasonFilter {
    return isTermsBreachReasonField(value);
}

export interface CreditInvoiceMembershipOptions {
    policyId?: number;
    customerId?: number;
    /**
     * Preferred over `customerId` when set (shell-root drill-down expands to
     * pool members via {@link resolveInvoiceReportCustomerIds}).
     */
    customerIds?: readonly number[];
    termsBreachReason?: string | null;
    termsOverdueOnly?: boolean;
    /** Reporting countdown window; loaded from account when omitted. */
    windowDays?: number;
}

function invoiceCustomerScopeWhere(
    options: Pick<CreditInvoiceMembershipOptions, "customerId" | "customerIds">
): Prisma.InvoiceWhereInput {
    if (options.customerIds != null && options.customerIds.length > 0) {
        return { customer_id: { in: [...options.customerIds] } };
    }
    if (options.customerId != null) {
        return { customer_id: options.customerId };
    }
    return {};
}

/** Base terms-breach membership (no search, no BU). */
export function termsBreachMembershipWhere(
    accountId: number,
    options: CreditInvoiceMembershipOptions = {}
): Prisma.InvoiceWhereInput {
    const statusFilter = options.termsOverdueOnly
        ? { status: invoice_status.Overdue }
        : { status: { in: [invoice_status.Due, invoice_status.Overdue] } };
    const reason = options.termsBreachReason;
    const breachFilter =
        reason && isTermsBreachReasonField(reason)
            ? { [reason]: true }
            : { OR: TERMS_BREACH_OR };

    return {
        account_id: accountId,
        ...statusFilter,
        ...breachFilter,
        // Credit notes (amount < 0) stay out of terms/reporting-breach lists.
        amount: { gte: 0 },
        Customer: { isNot: null },
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...invoiceCustomerScopeWhere(options),
    };
}

/** Open reporting-countdown membership (no search, no BU). */
export function reportingCountdownMembershipWhere(
    accountId: number,
    windowDays: number,
    options: Pick<
        CreditInvoiceMembershipOptions,
        "policyId" | "customerId" | "customerIds"
    > = {}
): Prisma.InvoiceWhereInput {
    const today = startOfDay(new Date());
    const lastInclusive = addDays(today, Math.max(0, windowDays));
    return {
        account_id: accountId,
        status: { in: [invoice_status.Due, invoice_status.Overdue] },
        target_reporting_date: { gte: today, lte: lastInclusive },
        actual_reporting_date: null,
        reporting_breach: false,
        // Credit notes (amount < 0) stay out of reporting countdown.
        amount: { gte: 0 },
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...invoiceCustomerScopeWhere(options),
    };
}

/** Reported invoices membership (no search, no BU). */
export function reportedInvoicesMembershipWhere(
    accountId: number,
    options: Pick<
        CreditInvoiceMembershipOptions,
        "policyId" | "customerId" | "customerIds"
    > = {}
): Prisma.InvoiceWhereInput {
    return {
        account_id: accountId,
        actual_reporting_date: { not: null },
        Customer: { isNot: null },
        ...(options.policyId != null ? { policy_id: options.policyId } : {}),
        ...invoiceCustomerScopeWhere(options),
    };
}

const DEFAULT_REPORTING_WINDOW_DAYS = 14;

export async function resolveReportingCountdownWindowDays(
    accountId: number
): Promise<number> {
    const account = await (prisma.account.findUnique as any)({
        where: { id: accountId },
        select: { reporting_date_warning_days: true },
    });
    const days = account?.reporting_date_warning_days;
    if (days == null || !Number.isFinite(Number(days))) {
        return DEFAULT_REPORTING_WINDOW_DAYS;
    }
    return Math.max(0, Number(days));
}
