import type { PrismaClient } from "@prisma/client";

import { resolveInvoicePaidTolerance } from "../../invoice/invoicePaidTolerance";
import { commitOps } from "../../import/bulkWrite";
import { findManyInChunks, PRISMA_IN_CHUNK } from "../../import/prismaInChunks";

export const VIRTUAL_PAYMENT_METHOD = "virtual";

export function buildVirtualPaymentReference(invoiceNumber: string): string {
    return `virtual|${invoiceNumber.trim()}`;
}

export type ReconciledVirtualCloseCandidate = {
    invoiceId: number;
    customerId: number;
    invoiceNumber: string;
    paymentDate: Date;
};

export type ReconciledVirtualCloseByNumbersResult = {
    touchedIds: number[];
    customerIds: number[];
    missingNumbers: string[];
};

type InvoiceCloseRow = {
    id: number;
    amount: number | null;
    customer_amount: number | null;
    customer_net_amount: number | null;
    customer_currency: string | null;
};

function resolveVirtualAmounts(
    invoice: InvoiceCloseRow,
    remainingCustomer: number
): { amount: number; customer_amount: number; customer_currency: string } {
    const customer_currency = (invoice.customer_currency ?? "").trim() || "ILS";
    const invoiceAmount = invoice.amount;
    const invoiceCustomerAmount = invoice.customer_amount;
    if (
        invoiceAmount != null &&
        invoiceCustomerAmount != null &&
        invoiceCustomerAmount !== 0
    ) {
        return {
            amount: remainingCustomer * (invoiceAmount / invoiceCustomerAmount),
            customer_amount: remainingCustomer,
            customer_currency,
        };
    }
    return {
        amount: remainingCustomer,
        customer_amount: remainingCustomer,
        customer_currency,
    };
}

/**
 * Account 10149: for reconciled IDG_ARFNCITEMS4 invoices, upsert/delete one
 * virtual payment per invoice so remaining (full or partial) closes.
 * Handles positive AR invoices and credit notes (negative net / remaining).
 * Callers then recalc paid totals.
 */
export async function applyReconciledVirtualCloses(
    prisma: Pick<
        PrismaClient,
        "invoice" | "invoicePayment" | "billingConnector" | "$transaction"
    >,
    accountId: number,
    candidates: ReconciledVirtualCloseCandidate[],
    userId?: string
): Promise<Set<number>> {
    const byInvoice = new Map<number, ReconciledVirtualCloseCandidate>();
    for (const candidate of candidates) {
        byInvoice.set(candidate.invoiceId, candidate);
    }
    if (byInvoice.size === 0) {
        return new Set();
    }

    const paidTolerance = await resolveInvoicePaidTolerance(prisma, accountId);

    const invoiceIds = [...byInvoice.keys()];
    const [invoices, linkedPayments] = await Promise.all([
        findManyInChunks(invoiceIds, (chunk) =>
            prisma.invoice.findMany({
                where: { id: { in: chunk } },
                select: {
                    id: true,
                    amount: true,
                    customer_amount: true,
                    customer_net_amount: true,
                    customer_currency: true,
                },
            })
        ),
        findManyInChunks(invoiceIds, (chunk) =>
            prisma.invoicePayment.findMany({
                where: { invoice_id: { in: chunk } },
                select: {
                    id: true,
                    invoice_id: true,
                    customer_amount: true,
                    payment_date: true,
                    payment_method: true,
                    reference: true,
                    customer_id: true,
                },
            })
        ),
    ]);

    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const paymentsByInvoice = new Map<
        number,
        Array<(typeof linkedPayments)[number]>
    >();
    for (const payment of linkedPayments) {
        if (payment.invoice_id == null) continue;
        const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
        list.push(payment);
        paymentsByInvoice.set(payment.invoice_id, list);
    }

    const touchedInvoiceIds = new Set<number>();
    const inserts: Array<Record<string, unknown>> = [];
    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
    const deleteIds: number[] = [];
    const now = new Date();

    for (const candidate of byInvoice.values()) {
        const invoice = invoiceById.get(candidate.invoiceId);
        if (!invoice) continue;

        const linked = paymentsByInvoice.get(candidate.invoiceId) ?? [];
        const virtualRef = buildVirtualPaymentReference(candidate.invoiceNumber);
        const existingVirtual =
            linked.find(
                (row) =>
                    row.reference === virtualRef ||
                    (row.payment_method ?? "").trim() === VIRTUAL_PAYMENT_METHOD
            ) ?? null;

        let realCustomerPaid = 0;
        let latestRealPaymentDate: Date | null = null;
        for (const payment of linked) {
            if (existingVirtual && payment.id === existingVirtual.id) {
                continue;
            }
            if (
                (payment.payment_method ?? "").trim() === VIRTUAL_PAYMENT_METHOD
            ) {
                continue;
            }
            realCustomerPaid += payment.customer_amount ?? 0;
            if (
                payment.payment_date &&
                (latestRealPaymentDate === null ||
                    payment.payment_date > latestRealPaymentDate)
            ) {
                latestRealPaymentDate = payment.payment_date;
            }
        }

        // Virtual close must carry the ERP payment date, not the import time.
        const virtualPaymentDate =
            latestRealPaymentDate ?? candidate.paymentDate;

        const net = invoice.customer_net_amount ?? invoice.customer_amount ?? 0;
        const remaining = net - realCustomerPaid;
        touchedInvoiceIds.add(candidate.invoiceId);

        // Positive invoices: remaining > T. Credit notes (negative net): remaining < -T.
        // Virtual payment equals remaining so net − (real + virtual) ≈ 0 after recalc.
        const needsVirtual =
            remaining > paidTolerance || remaining < -paidTolerance;

        if (needsVirtual) {
            const amounts = resolveVirtualAmounts(invoice, remaining);
            if (existingVirtual) {
                updates.push({
                    id: existingVirtual.id,
                    data: {
                        amount: amounts.amount,
                        customer_amount: amounts.customer_amount,
                        customer_currency: amounts.customer_currency,
                        payment_date: virtualPaymentDate,
                        payment_method: VIRTUAL_PAYMENT_METHOD,
                        reference: virtualRef,
                        invoice_id: candidate.invoiceId,
                        invoice_number: candidate.invoiceNumber,
                        modified_by: userId ?? null,
                        modified_at: now,
                    },
                });
            } else {
                inserts.push({
                    invoice_id: candidate.invoiceId,
                    invoice_number: candidate.invoiceNumber,
                    amount: amounts.amount,
                    customer_amount: amounts.customer_amount,
                    customer_currency: amounts.customer_currency,
                    payment_date: virtualPaymentDate,
                    payment_method: VIRTUAL_PAYMENT_METHOD,
                    reference: virtualRef,
                    customer_id: candidate.customerId,
                    account_id: accountId,
                    created_by: userId ?? null,
                    modified_by: userId ?? null,
                });
            }
        } else if (existingVirtual) {
            deleteIds.push(existingVirtual.id);
        }
    }

    if (inserts.length > 0) {
        for (let i = 0; i < inserts.length; i += PRISMA_IN_CHUNK) {
            const chunk = inserts.slice(i, i + PRISMA_IN_CHUNK);
            await prisma.invoicePayment.createMany({ data: chunk as never });
        }
    }
    if (updates.length > 0) {
        await commitOps(
            prisma,
            updates.map((row) =>
                prisma.invoicePayment.update({
                    where: { id: row.id },
                    data: row.data as never,
                })
            )
        );
    }
    if (deleteIds.length > 0) {
        for (let i = 0; i < deleteIds.length; i += PRISMA_IN_CHUNK) {
            const chunk = deleteIds.slice(i, i + PRISMA_IN_CHUNK);
            await prisma.invoicePayment.deleteMany({
                where: { id: { in: chunk }, account_id: accountId },
            });
        }
    }

    return touchedInvoiceIds;
}

/**
 * Resolve invoice numbers from the payment feed and fill virtual shortfall
 * (full net when no real payments). Caller must recalc paid totals.
 */
export async function applyReconciledVirtualClosesForInvoiceNumbers(
    prisma: Pick<
        PrismaClient,
        "invoice" | "invoicePayment" | "billingConnector" | "$transaction"
    >,
    accountId: number,
    invoiceNumbers: string[],
    userId?: string,
    /** ERP CURDATE per invoice number; used when the invoice has no real payment. */
    paymentDates?: Map<string, Date>,
    paymentDate: Date = new Date()
): Promise<ReconciledVirtualCloseByNumbersResult> {
    const unique = Array.from(
        new Set(
            invoiceNumbers
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
        )
    );
    if (unique.length === 0) {
        return { touchedIds: [], customerIds: [], missingNumbers: [] };
    }

    const invoices = await findManyInChunks(unique, (chunk) =>
        prisma.invoice.findMany({
            where: {
                account_id: accountId,
                invoice_number: { in: chunk },
            },
            select: {
                id: true,
                invoice_number: true,
                customer_id: true,
            },
        })
    );

    const foundNumbers = new Set(
        invoices
            .map((row) => row.invoice_number)
            .filter((value): value is string => Boolean(value))
    );
    const missingNumbers = unique.filter((value) => !foundNumbers.has(value));
    if (invoices.length === 0) {
        return { touchedIds: [], customerIds: [], missingNumbers };
    }

    const candidates: ReconciledVirtualCloseCandidate[] = [];
    const customerIds = new Set<number>();
    for (const invoice of invoices) {
        if (invoice.customer_id == null || !invoice.invoice_number) continue;
        candidates.push({
            invoiceId: invoice.id,
            customerId: invoice.customer_id,
            invoiceNumber: invoice.invoice_number,
            paymentDate:
                paymentDates?.get(invoice.invoice_number.trim()) ?? paymentDate,
        });
        customerIds.add(invoice.customer_id);
    }

    const touched = await applyReconciledVirtualCloses(
        prisma,
        accountId,
        candidates,
        userId
    );

    return {
        touchedIds: [...touched],
        customerIds: [...customerIds],
        missingNumbers,
    };
}
