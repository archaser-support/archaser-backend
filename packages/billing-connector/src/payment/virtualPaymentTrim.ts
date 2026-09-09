import type { PrismaClient } from "@prisma/client";

import { resolveInvoicePaidTolerance } from "../invoice/invoicePaidTolerance";
import { commitOps } from "../import/bulkWrite";
import { findManyInChunks, PRISMA_IN_CHUNK } from "../import/prismaInChunks";

export const VIRTUAL_PAYMENT_METHOD = "virtual";

export function buildVirtualPaymentReference(invoiceNumber: string): string {
    return `virtual|${invoiceNumber.trim()}`;
}

export function isVirtualPaymentMethod(
    paymentMethod: string | null | undefined
): boolean {
    return (paymentMethod ?? "").trim() === VIRTUAL_PAYMENT_METHOD;
}

export type VirtualInvoiceAmounts = {
    id: number;
    amount: number | null;
    customer_amount: number | null;
    customer_net_amount: number | null;
    customer_currency: string | null;
};

export type VirtualLinkedPayment = {
    id: number;
    invoice_id: number | null;
    customer_amount: number | null;
    payment_date: Date | null;
    payment_method: string | null;
    reference: string | null;
};

/**
 * Map remaining customer shortfall onto invoice FX (amount vs customer_amount).
 */
export function resolveVirtualAmounts(
    invoice: Pick<
        VirtualInvoiceAmounts,
        "amount" | "customer_amount" | "customer_currency"
    >,
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

export function invoiceCustomerNet(
    invoice: Pick<VirtualInvoiceAmounts, "customer_net_amount" | "customer_amount">
): number {
    return invoice.customer_net_amount ?? invoice.customer_amount ?? 0;
}

/**
 * Positive invoices: remaining > T. Credit notes (negative net): remaining < -T.
 */
export function needsVirtualForRemaining(
    remaining: number,
    paidTolerance: number
): boolean {
    return remaining > paidTolerance || remaining < -paidTolerance;
}

export function findExistingVirtualPayment(
    linked: VirtualLinkedPayment[],
    invoiceNumber: string
): VirtualLinkedPayment | null {
    const virtualRef = buildVirtualPaymentReference(invoiceNumber);
    return (
        linked.find(
            (row) =>
                row.reference === virtualRef ||
                isVirtualPaymentMethod(row.payment_method)
        ) ?? null
    );
}

export function sumRealCustomerPaidExcludingVirtual(
    linked: VirtualLinkedPayment[],
    existingVirtual: VirtualLinkedPayment | null
): { realCustomerPaid: number; latestRealPaymentDate: Date | null } {
    let realCustomerPaid = 0;
    let latestRealPaymentDate: Date | null = null;
    for (const payment of linked) {
        if (existingVirtual && payment.id === existingVirtual.id) {
            continue;
        }
        if (isVirtualPaymentMethod(payment.payment_method)) {
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
    return { realCustomerPaid, latestRealPaymentDate };
}

export type ShrinkVirtualPaymentsResult = {
    touchedInvoiceIds: number[];
    updatedCount: number;
    deletedCount: number;
};

type VirtualTrimPrisma = Pick<
    PrismaClient,
    "invoice" | "invoicePayment" | "billingConnector" | "$transaction"
>;

/**
 * Shrink or delete existing virtual payments so virtual equals leftover only.
 * Never creates virtual rows. Callers should recalc paid totals afterward.
 */
export async function shrinkOrDeleteVirtualPaymentsForInvoiceIds(
    prisma: VirtualTrimPrisma,
    accountId: number,
    invoiceIds: number[],
    options?: { userId?: string; paidTolerance?: number }
): Promise<ShrinkVirtualPaymentsResult> {
    const uniqueIds = Array.from(
        new Set(invoiceIds.filter((id) => Number.isFinite(id)))
    );
    if (uniqueIds.length === 0) {
        return { touchedInvoiceIds: [], updatedCount: 0, deletedCount: 0 };
    }

    const paidTolerance =
        options?.paidTolerance ??
        (await resolveInvoicePaidTolerance(prisma, accountId));

    const [invoices, linkedPayments] = await Promise.all([
        findManyInChunks(uniqueIds, (chunk) =>
            prisma.invoice.findMany({
                where: { id: { in: chunk }, account_id: accountId },
                select: {
                    id: true,
                    invoice_number: true,
                    amount: true,
                    customer_amount: true,
                    customer_net_amount: true,
                    customer_currency: true,
                },
            })
        ),
        findManyInChunks(uniqueIds, (chunk) =>
            prisma.invoicePayment.findMany({
                where: { invoice_id: { in: chunk }, account_id: accountId },
                select: {
                    id: true,
                    invoice_id: true,
                    customer_amount: true,
                    payment_date: true,
                    payment_method: true,
                    reference: true,
                },
            })
        ),
    ]);

    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const paymentsByInvoice = new Map<number, VirtualLinkedPayment[]>();
    for (const payment of linkedPayments) {
        if (payment.invoice_id == null) continue;
        const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
        list.push(payment);
        paymentsByInvoice.set(payment.invoice_id, list);
    }

    const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
    const deleteIds: number[] = [];
    const touchedInvoiceIds: number[] = [];
    const now = new Date();
    const userId = options?.userId ?? null;

    for (const invoiceId of uniqueIds) {
        const invoice = invoiceById.get(invoiceId);
        if (!invoice?.invoice_number) continue;

        const linked = paymentsByInvoice.get(invoiceId) ?? [];
        const existingVirtual = findExistingVirtualPayment(
            linked,
            invoice.invoice_number
        );
        if (!existingVirtual) {
            continue;
        }

        const { realCustomerPaid, latestRealPaymentDate } =
            sumRealCustomerPaidExcludingVirtual(linked, existingVirtual);
        const net = invoiceCustomerNet(invoice);
        const remaining = net - realCustomerPaid;
        touchedInvoiceIds.push(invoiceId);

        if (!needsVirtualForRemaining(remaining, paidTolerance)) {
            deleteIds.push(existingVirtual.id);
            continue;
        }

        const amounts = resolveVirtualAmounts(invoice, remaining);
        const virtualRef = buildVirtualPaymentReference(invoice.invoice_number);
        updates.push({
            id: existingVirtual.id,
            data: {
                amount: amounts.amount,
                customer_amount: amounts.customer_amount,
                customer_currency: amounts.customer_currency,
                payment_date:
                    latestRealPaymentDate ?? existingVirtual.payment_date,
                payment_method: VIRTUAL_PAYMENT_METHOD,
                reference: virtualRef,
                invoice_id: invoiceId,
                invoice_number: invoice.invoice_number,
                modified_by: userId,
                modified_at: now,
            },
        });
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

    return {
        touchedInvoiceIds,
        updatedCount: updates.length,
        deletedCount: deleteIds.length,
    };
}

/**
 * Overpay detector for surplus-virtual repair: |paid| > |net| + tolerance.
 */
export function isAbsOverpaidInvoice(
    customerTotalPaid: number | null | undefined,
    customerNetAmount: number | null | undefined,
    paidTolerance: number
): boolean {
    const paid = customerTotalPaid ?? 0;
    const net = customerNetAmount ?? 0;
    return Math.abs(paid) > Math.abs(net) + paidTolerance;
}
