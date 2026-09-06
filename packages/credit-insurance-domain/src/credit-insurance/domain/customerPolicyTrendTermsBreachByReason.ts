import { Prisma } from "@prisma/client";

import { prisma } from "../domain-db";

import type { TermsBreachCountByReason } from "./creditInsuranceDashboardService";

export type TermsBreachReasonSnapshot = {
    count: number;
    amount: number;
};

export type TermsBreachByReasonSnapshotKey =
    keyof (TermsBreachCountByReason & { other: number });

export type TermsBreachByReasonSnapshot = Partial<
    Record<TermsBreachByReasonSnapshotKey, TermsBreachReasonSnapshot>
>;

export type TermsBreachInvoiceForAggregation = {
    policyId: number | null;
    outstanding: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
};

const REASON_KEYS: TermsBreachByReasonSnapshotKey[] = [
    "reportingBreach",
    "paymentTerm",
    "customerOverdueMep",
    "outdatedDcl",
    "invoiceAfterPolicyEnd",
    "other",
];

function emptyBuckets(): Record<
    TermsBreachByReasonSnapshotKey,
    TermsBreachReasonSnapshot
> {
    return {
        reportingBreach: { count: 0, amount: 0 },
        paymentTerm: { count: 0, amount: 0 },
        customerOverdueMep: { count: 0, amount: 0 },
        outdatedDcl: { count: 0, amount: 0 },
        invoiceAfterPolicyEnd: { count: 0, amount: 0 },
        other: { count: 0, amount: 0 },
    };
}

export function invoiceOutstandingInAccountCurrency(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number {
    const debt = Number(row.outstanding_debt ?? 0);
    if (debt !== 0) {
        return Math.max(0, debt);
    }
    return Math.max(0, Number(row.customer_outstanding_debt ?? 0));
}

export function invoiceMatchesPolicyScope(
    policyId: number | null,
    scope: number | null | undefined
): boolean {
    if (scope === undefined) {
        return true;
    }
    if (scope === null) {
        return policyId == null;
    }
    return policyId === scope;
}

export function invoiceHasTermsBreachFlag(
    invoice: Pick<
        TermsBreachInvoiceForAggregation,
        | "reportingBreach"
        | "ctvPaymentTerm"
        | "ctvCustomerOverdueMep"
        | "ctvOutdatedDcl"
        | "ctvInvoiceAfterPolicyEnd"
    >
): boolean {
    return (
        invoice.reportingBreach ||
        invoice.ctvPaymentTerm ||
        invoice.ctvCustomerOverdueMep ||
        invoice.ctvOutdatedDcl ||
        invoice.ctvInvoiceAfterPolicyEnd
    );
}

function compactTermsBreachByReasonSnapshot(
    buckets: Record<TermsBreachByReasonSnapshotKey, TermsBreachReasonSnapshot>
): TermsBreachByReasonSnapshot {
    const snapshot: TermsBreachByReasonSnapshot = {};
    for (const key of REASON_KEYS) {
        const bucket = buckets[key];
        if (bucket.count > 0 || bucket.amount > 0) {
            snapshot[key] = {
                count: bucket.count,
                amount: bucket.amount,
            };
        }
    }
    return snapshot;
}

/**
 * Pure aggregator: Due/Overdue breach invoices → count + amount per reason.
 * Multi-flag invoices contribute to each applicable bucket (full outstanding each time).
 */
export function aggregateTermsBreachByReasonFromInvoices(
    invoices: TermsBreachInvoiceForAggregation[],
    policyScope?: number | null
): TermsBreachByReasonSnapshot {
    const buckets = emptyBuckets();

    for (const invoice of invoices) {
        if (!invoiceMatchesPolicyScope(invoice.policyId, policyScope)) {
            continue;
        }
        if (!invoiceHasTermsBreachFlag(invoice)) {
            continue;
        }

        const outstanding = Math.max(0, invoice.outstanding);
        const flags: Array<[TermsBreachByReasonSnapshotKey, boolean]> = [
            ["reportingBreach", invoice.reportingBreach],
            ["paymentTerm", invoice.ctvPaymentTerm],
            ["customerOverdueMep", invoice.ctvCustomerOverdueMep],
            ["outdatedDcl", invoice.ctvOutdatedDcl],
            ["invoiceAfterPolicyEnd", invoice.ctvInvoiceAfterPolicyEnd],
        ];

        let matchedKnownReason = false;
        for (const [key, isOn] of flags) {
            if (!isOn) {
                continue;
            }
            matchedKnownReason = true;
            buckets[key].count += 1;
            buckets[key].amount += outstanding;
        }

        if (!matchedKnownReason) {
            buckets.other.count += 1;
            buckets.other.amount += outstanding;
        }
    }

    return compactTermsBreachByReasonSnapshot(buckets);
}

export type CustomerTermsBreachByReasonSnapshotResult = {
    snapshot: TermsBreachByReasonSnapshot;
    invoiceCount: number;
};

/**
 * Live (or as-of) breach invoices for one customer, optionally scoped to one insurance policy
 * (`null` = invoices with no `policy_id`).
 * When `asOfDate` is set, uses payment-ledger open amounts instead of live Due/Overdue.
 */
export async function getCustomerTermsBreachByReasonSnapshot(
    accountId: number,
    customerId: number,
    policyId: number | null,
    options?: { asOfDate?: Date }
): Promise<CustomerTermsBreachByReasonSnapshotResult> {
    if (options?.asOfDate) {
        const { loadAsOfOpenInvoiceCandidates, computeAsOfOpenInvoiceLine } =
            await import("./asOfOpenAr");
        const lines = await loadAsOfOpenInvoiceCandidates(
            accountId,
            options.asOfDate,
            {
                customerIds: [customerId],
                policyId: policyId ?? undefined,
            }
        );
        const invoices: TermsBreachInvoiceForAggregation[] = [];
        for (const line of lines) {
            if (
                line.amount != null &&
                Number.isFinite(Number(line.amount)) &&
                Number(line.amount) < 0
            ) {
                continue;
            }
            const isBreach =
                line.reportingBreach ||
                line.ctvPaymentTerm ||
                line.ctvCustomerOverdueMep ||
                line.ctvOutdatedDcl ||
                line.ctvInvoiceAfterPolicyEnd;
            if (!isBreach) {
                continue;
            }
            const computed = computeAsOfOpenInvoiceLine(line, options.asOfDate);
            if (!computed) {
                continue;
            }
            if (policyId === null && computed.policyId != null) {
                continue;
            }
            if (policyId != null && computed.policyId !== policyId) {
                continue;
            }
            invoices.push({
                policyId: computed.policyId,
                outstanding: computed.openAmount,
                reportingBreach: computed.reportingBreach,
                ctvPaymentTerm: computed.ctvPaymentTerm,
                ctvCustomerOverdueMep: computed.ctvCustomerOverdueMep,
                ctvOutdatedDcl: computed.ctvOutdatedDcl,
                ctvInvoiceAfterPolicyEnd: computed.ctvInvoiceAfterPolicyEnd,
            });
        }
        return {
            snapshot: aggregateTermsBreachByReasonFromInvoices(invoices, policyId),
            invoiceCount: invoices.length,
        };
    }

    const rows = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
            amount: { gte: 0 },
            ...(policyId === null
                ? { policy_id: null }
                : { policy_id: policyId }),
            OR: [
                { reporting_breach: true },
                { ctv_payment_term: true },
                { ctv_customer_overdue_mep: true },
                { ctv_outdated_dcl: true },
                { ctv_invoice_after_policy_end: true },
            ],
        },
        select: {
            policy_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            reporting_breach: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: true,
            ctv_outdated_dcl: true,
            ctv_invoice_after_policy_end: true,
        },
    });

    const invoices: TermsBreachInvoiceForAggregation[] = rows.map((row) => ({
        policyId: row.policy_id,
        outstanding: invoiceOutstandingInAccountCurrency(row),
        reportingBreach: row.reporting_breach,
        ctvPaymentTerm: row.ctv_payment_term,
        ctvCustomerOverdueMep: row.ctv_customer_overdue_mep,
        ctvOutdatedDcl: row.ctv_outdated_dcl,
        ctvInvoiceAfterPolicyEnd: row.ctv_invoice_after_policy_end,
    }));

    return {
        snapshot: aggregateTermsBreachByReasonFromInvoices(invoices, policyId),
        invoiceCount: invoices.length,
    };
}

export function termsBreachByReasonSnapshotToJson(
    snapshot: TermsBreachByReasonSnapshot
): Prisma.InputJsonValue {
    return snapshot as Prisma.InputJsonValue;
}
