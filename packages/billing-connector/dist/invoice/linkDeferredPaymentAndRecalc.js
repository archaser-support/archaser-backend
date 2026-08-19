"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDIGITAL_HELAM_PAYMENT_METHOD = exports.INVOICE_PAID_TOLERANCE = void 0;
exports.recalculateInvoiceFromLinkedPayments = recalculateInvoiceFromLinkedPayments;
exports.linkDeferredPaymentAndRecalc = linkDeferredPaymentAndRecalc;
exports.INVOICE_PAID_TOLERANCE = 0.2;
/** Exact FNCPATNAME close code stored on InvoicePayment.payment_method. */
exports.IDIGITAL_HELAM_PAYMENT_METHOD = "חלמ";
function isConnectorHelamPayment(payment) {
    return (payment.payment_method ?? "").trim() === exports.IDIGITAL_HELAM_PAYMENT_METHOD;
}
function hasConnectorHelamClose(payments) {
    return payments.some(isConnectorHelamPayment);
}
async function recalculateInvoiceFromLinkedPayments(tx, invoiceId, options) {
    const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
    });
    if (!invoice) {
        throw new Error(`Invoice ${invoiceId} not found`);
    }
    const linkedPayments = await tx.invoicePayment.findMany({
        where: { invoice_id: invoiceId },
        select: {
            id: true,
            payment_date: true,
            amount: true,
            customer_amount: true,
            payment_method: true,
        },
    });
    if (hasConnectorHelamClose(linkedPayments)) {
        const totalPaid = invoice.net_amount ?? 0;
        const totalCustomerPaid = invoice.customer_net_amount ?? 0;
        return tx.invoice.update({
            where: { id: invoiceId },
            data: {
                total_paid: totalPaid,
                customer_total_paid: totalCustomerPaid,
                outstanding_debt: 0,
                customer_outstanding_debt: 0,
                status: "Paid",
                zero_limit_alert: false,
                reporting_breach: false,
            },
        });
    }
    const useAbsPaidTotals = options?.normalizeNegativePaymentsForCreditClose === true &&
        invoice.priority_erp_debit === "C";
    let totalPaid = 0;
    let totalCustomerPaid = 0;
    if (useAbsPaidTotals) {
        for (const payment of linkedPayments) {
            totalPaid += Math.abs(payment.amount ?? 0);
            totalCustomerPaid += Math.abs(payment.customer_amount ?? 0);
        }
    }
    else {
        for (const payment of linkedPayments) {
            totalPaid += payment.amount ?? 0;
            totalCustomerPaid += payment.customer_amount ?? 0;
        }
    }
    const newOutstanding = (invoice.net_amount ?? 0) - totalPaid;
    const newCustomerOutstanding = (invoice.customer_net_amount ?? 0) - totalCustomerPaid;
    const becomesPaid = newCustomerOutstanding <= exports.INVOICE_PAID_TOLERANCE;
    return tx.invoice.update({
        where: { id: invoiceId },
        data: {
            total_paid: totalPaid,
            customer_total_paid: totalCustomerPaid,
            outstanding_debt: newOutstanding,
            customer_outstanding_debt: newCustomerOutstanding,
            status: becomesPaid ? "Paid" : invoice.status,
            ...(becomesPaid && {
                zero_limit_alert: false,
                reporting_breach: false,
            }),
        },
    });
}
async function linkDeferredPaymentAndRecalc(prisma, params) {
    const { invoicePaymentId, invoiceId, forceRecalc = false } = params;
    return prisma.$transaction(async (tx) => {
        const payment = await tx.invoicePayment.findUnique({
            where: { id: invoicePaymentId },
        });
        if (!payment) {
            throw new Error(`InvoicePayment ${invoicePaymentId} not found`);
        }
        if (payment.invoice_id === invoiceId) {
            if (!forceRecalc) {
                const invoice = await tx.invoice.findUnique({
                    where: { id: invoiceId },
                });
                if (!invoice) {
                    throw new Error(`Invoice ${invoiceId} not found`);
                }
                return {
                    invoicePayment: payment,
                    updatedInvoice: invoice,
                    alreadyLinked: true,
                };
            }
            const updatedInvoice = await recalculateInvoiceFromLinkedPayments(tx, invoiceId);
            return {
                invoicePayment: payment,
                updatedInvoice,
                alreadyLinked: true,
            };
        }
        if (payment.invoice_id !== null) {
            throw new Error(`InvoicePayment ${invoicePaymentId} is already linked to invoice ${payment.invoice_id}`);
        }
        const linkedPayment = await tx.invoicePayment.update({
            where: { id: invoicePaymentId },
            data: { invoice_id: invoiceId },
        });
        const updatedInvoice = await recalculateInvoiceFromLinkedPayments(tx, invoiceId);
        return {
            invoicePayment: linkedPayment,
            updatedInvoice,
            alreadyLinked: false,
        };
    });
}
