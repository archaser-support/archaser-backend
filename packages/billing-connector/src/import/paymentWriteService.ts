import type { Invoice, InvoicePayment, PrismaClient } from "@prisma/client";
import {
    recalculateInvoiceFromLinkedPayments,
} from "../invoice/linkDeferredPaymentAndRecalc";

export interface CreatePaymentData {
    invoice_id: number;
    invoice_number?: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}

export interface CreateDeferredPaymentData {
    invoice_number: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}

export interface UpdatePaymentData {
    id: number;
    invoice_id: number | null;
    invoice_number?: string;
    customer_currency: string;
    payment_date: Date;
    amount: number;
    payment_method: string;
    reference: string;
    customer_id: number;
    account_id: number;
    customer_amount: number;
    created_by?: string | null;
    modified_by?: string | null;
}

export async function createLinkedInvoicePayment(
    prisma: PrismaClient,
    data: CreatePaymentData
): Promise<{ invoicePayment: InvoicePayment; updatedInvoice: Invoice }> {
    return prisma.$transaction(async (tx) => {
        let invoiceNumber =
            typeof data.invoice_number === "string"
                ? data.invoice_number.trim()
                : "";
        if (!invoiceNumber) {
            const invoice = await tx.invoice.findUnique({
                where: { id: data.invoice_id },
                select: { invoice_number: true },
            });
            invoiceNumber = invoice?.invoice_number?.trim() ?? "";
        }

        const createdPayment = await tx.invoicePayment.create({
            data: {
                invoice_id: data.invoice_id,
                ...(invoiceNumber ? { invoice_number: invoiceNumber } : {}),
                customer_currency: data.customer_currency,
                payment_date: data.payment_date,
                amount: data.amount,
                payment_method: data.payment_method,
                reference: data.reference,
                customer_id: data.customer_id,
                account_id: data.account_id,
                customer_amount: data.customer_amount,
                created_by: data.created_by ?? null,
                modified_by: data.modified_by ?? null,
            },
        });

        const updatedInvoice = await recalculateInvoiceFromLinkedPayments(
            tx,
            data.invoice_id
        );

        return { invoicePayment: createdPayment, updatedInvoice };
    });
}

export async function createDeferredInvoicePayment(
    prisma: PrismaClient,
    data: CreateDeferredPaymentData
): Promise<InvoicePayment> {
    return prisma.invoicePayment.create({
        data: {
            invoice_id: null,
            invoice_number: data.invoice_number,
            customer_currency: data.customer_currency,
            payment_date: data.payment_date,
            amount: data.amount,
            payment_method: data.payment_method,
            reference: data.reference,
            customer_id: data.customer_id,
            account_id: data.account_id,
            customer_amount: data.customer_amount,
            created_by: data.created_by ?? null,
            modified_by: data.modified_by ?? null,
        },
    });
}

export async function updateInvoicePayment(
    prisma: PrismaClient,
    data: UpdatePaymentData
): Promise<{ invoicePayment: InvoicePayment }> {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.invoicePayment.findUnique({
            where: { id: data.id },
            select: { id: true, invoice_id: true },
        });
        if (!existing) {
            throw new Error(`InvoicePayment ${data.id} not found`);
        }

        let invoiceNumber =
            typeof data.invoice_number === "string"
                ? data.invoice_number.trim()
                : "";
        if (!invoiceNumber && data.invoice_id != null) {
            const invoice = await tx.invoice.findUnique({
                where: { id: data.invoice_id },
                select: { invoice_number: true },
            });
            invoiceNumber = invoice?.invoice_number?.trim() ?? "";
        }

        const updatedPayment = await tx.invoicePayment.update({
            where: { id: data.id },
            data: {
                invoice_id: data.invoice_id,
                invoice_number: invoiceNumber || null,
                customer_currency: data.customer_currency,
                payment_date: data.payment_date,
                amount: data.amount,
                payment_method: data.payment_method,
                reference: data.reference,
                customer_amount: data.customer_amount,
                modified_by: data.modified_by ?? null,
                modified_at: new Date(),
            },
        });

        const previousInvoiceId = existing.invoice_id;
        const newInvoiceId = data.invoice_id;
        if (
            previousInvoiceId != null &&
            previousInvoiceId !== newInvoiceId
        ) {
            await recalculateInvoiceFromLinkedPayments(
                tx,
                previousInvoiceId
            );
        }
        if (newInvoiceId != null) {
            await recalculateInvoiceFromLinkedPayments(tx, newInvoiceId);
        }

        return { invoicePayment: updatedPayment };
    });
}
