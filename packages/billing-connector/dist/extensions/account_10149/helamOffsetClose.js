"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyHelamOffsetStampClosesForInvoiceNumbers = applyHelamOffsetStampClosesForInvoiceNumbers;
const bulkWrite_1 = require("../../import/bulkWrite");
const prismaInChunks_1 = require("../../import/prismaInChunks");
const pendingCloseProgress_1 = require("../pendingCloseProgress");
const reconciledVirtualClose_1 = require("./reconciledVirtualClose");
/** Priority Helam (חלמ) payment method label on cancel stamp lines. */
const HELAM_PAYMENT_METHOD = "חלמ";
/**
 * Stamp Helam offset-pair invoices Paid from net (no virtual, no cancel payment).
 * Removes leftover virtual / Helam method payments so paid totals stay correct.
 */
async function applyHelamOffsetStampClosesForInvoiceNumbers(prisma, accountId, invoiceNumbers, userId, options) {
    const unique = Array.from(new Set(invoiceNumbers
        .map((value) => value.trim())
        .filter((value) => value.length > 0)));
    if (unique.length === 0) {
        return { closedIds: [], customerIds: [], missingNumbers: [] };
    }
    const invoices = await (0, prismaInChunks_1.findManyInChunks)(unique, (chunk) => prisma.invoice.findMany({
        where: {
            account_id: accountId,
            invoice_number: { in: chunk },
        },
        select: {
            id: true,
            invoice_number: true,
            customer_id: true,
            net_amount: true,
            customer_net_amount: true,
        },
    }));
    const foundNumbers = new Set(invoices
        .map((row) => row.invoice_number)
        .filter((value) => Boolean(value)));
    const missingNumbers = unique.filter((value) => !foundNumbers.has(value));
    if (invoices.length === 0) {
        return { closedIds: [], customerIds: [], missingNumbers };
    }
    const invoiceIds = invoices.map((row) => row.id);
    const linkedPayments = await (0, prismaInChunks_1.findManyInChunks)(invoiceIds, (chunk) => prisma.invoicePayment.findMany({
        where: { invoice_id: { in: chunk }, account_id: accountId },
        select: {
            id: true,
            payment_method: true,
        },
    }));
    const deleteIds = linkedPayments
        .filter((payment) => {
        const method = (payment.payment_method ?? "").trim();
        return (method === reconciledVirtualClose_1.VIRTUAL_PAYMENT_METHOD ||
            method === HELAM_PAYMENT_METHOD);
    })
        .map((payment) => payment.id);
    if (deleteIds.length > 0) {
        for (let i = 0; i < deleteIds.length; i += prismaInChunks_1.PRISMA_IN_CHUNK) {
            const chunk = deleteIds.slice(i, i + prismaInChunks_1.PRISMA_IN_CHUNK);
            await prisma.invoicePayment.deleteMany({
                where: { id: { in: chunk }, account_id: accountId },
            });
        }
    }
    const now = new Date();
    const customerIds = new Set();
    const updates = invoices.map((invoice) => {
        if (invoice.customer_id != null) {
            customerIds.add(invoice.customer_id);
        }
        const totalPaid = invoice.net_amount ?? 0;
        const totalCustomerPaid = invoice.customer_net_amount ?? 0;
        return prisma.invoice.update({
            where: { id: invoice.id },
            data: {
                total_paid: totalPaid,
                customer_total_paid: totalCustomerPaid,
                outstanding_debt: 0,
                customer_outstanding_debt: 0,
                status: "Paid",
                zero_limit_alert: false,
                reporting_breach: false,
                modified_at: now,
                modified_by: userId ?? null,
            },
        });
    });
    if (!options?.onProgress) {
        await (0, bulkWrite_1.commitOps)(prisma, updates);
    }
    else {
        options.onProgress({ processed: 0, total: invoices.length });
        for (let offset = 0; offset < updates.length; offset += pendingCloseProgress_1.PENDING_CLOSE_PROGRESS_CHUNK) {
            const chunk = updates.slice(offset, offset + pendingCloseProgress_1.PENDING_CLOSE_PROGRESS_CHUNK);
            await (0, bulkWrite_1.commitOps)(prisma, chunk);
            options.onProgress({
                processed: Math.min(offset + chunk.length, invoices.length),
                total: invoices.length,
            });
        }
    }
    return {
        closedIds: invoiceIds,
        customerIds: [...customerIds],
        missingNumbers,
    };
}
