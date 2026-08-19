"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLinkedInvoicePayment = createLinkedInvoicePayment;
exports.createDeferredInvoicePayment = createDeferredInvoicePayment;
exports.updateInvoicePayment = updateInvoicePayment;
const linkDeferredPaymentAndRecalc_1 = require("../invoice/linkDeferredPaymentAndRecalc");
async function createLinkedInvoicePayment(prisma, data, options) {
    return prisma.$transaction(async (tx) => {
        let invoiceNumber = typeof data.invoice_number === "string"
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
        const updatedInvoice = await (0, linkDeferredPaymentAndRecalc_1.recalculateInvoiceFromLinkedPayments)(tx, data.invoice_id, {
            normalizeNegativePaymentsForCreditClose: options?.normalizeNegativePaymentsForCreditClose,
        });
        return { invoicePayment: createdPayment, updatedInvoice };
    });
}
async function createDeferredInvoicePayment(prisma, data) {
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
async function updateInvoicePayment(prisma, data, options) {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.invoicePayment.findUnique({
            where: { id: data.id },
            select: { id: true, invoice_id: true },
        });
        if (!existing) {
            throw new Error(`InvoicePayment ${data.id} not found`);
        }
        let invoiceNumber = typeof data.invoice_number === "string"
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
            },
        });
        const previousInvoiceId = existing.invoice_id;
        const newInvoiceId = data.invoice_id;
        if (previousInvoiceId != null &&
            previousInvoiceId !== newInvoiceId) {
            await (0, linkDeferredPaymentAndRecalc_1.recalculateInvoiceFromLinkedPayments)(tx, previousInvoiceId, {
                normalizeNegativePaymentsForCreditClose: options?.normalizeNegativePaymentsForCreditClose,
            });
        }
        if (newInvoiceId != null) {
            await (0, linkDeferredPaymentAndRecalc_1.recalculateInvoiceFromLinkedPayments)(tx, newInvoiceId, {
                normalizeNegativePaymentsForCreditClose: options?.normalizeNegativePaymentsForCreditClose,
            });
        }
        return { invoicePayment: updatedPayment };
    });
}
