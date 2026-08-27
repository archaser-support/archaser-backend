"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIRTUAL_PAYMENT_METHOD = void 0;
exports.buildVirtualPaymentReference = buildVirtualPaymentReference;
exports.applyReconciledVirtualCloses = applyReconciledVirtualCloses;
const invoicePaidTolerance_1 = require("../../invoice/invoicePaidTolerance");
const bulkWrite_1 = require("../../import/bulkWrite");
exports.VIRTUAL_PAYMENT_METHOD = "virtual";
function buildVirtualPaymentReference(invoiceNumber) {
    return `virtual|${invoiceNumber.trim()}`;
}
function resolveVirtualAmounts(invoice, remainingCustomer) {
    const customer_currency = (invoice.customer_currency ?? "").trim() || "ILS";
    const invoiceAmount = invoice.amount;
    const invoiceCustomerAmount = invoice.customer_amount;
    if (invoiceAmount != null &&
        invoiceCustomerAmount != null &&
        invoiceCustomerAmount !== 0) {
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
 * Account 10149: for reconciled receipts, upsert/delete one virtual payment per
 * invoice so shortfall closes. Callers then recalc paid totals.
 */
async function applyReconciledVirtualCloses(prisma, accountId, candidates, userId) {
    const byInvoice = new Map();
    for (const candidate of candidates) {
        byInvoice.set(candidate.invoiceId, candidate);
    }
    if (byInvoice.size === 0) {
        return new Set();
    }
    const invoiceIds = [...byInvoice.keys()];
    const [invoices, linkedPayments] = await Promise.all([
        prisma.invoice.findMany({
            where: { id: { in: invoiceIds } },
            select: {
                id: true,
                amount: true,
                customer_amount: true,
                customer_net_amount: true,
                customer_currency: true,
            },
        }),
        prisma.invoicePayment.findMany({
            where: { invoice_id: { in: invoiceIds } },
            select: {
                id: true,
                invoice_id: true,
                customer_amount: true,
                payment_method: true,
                reference: true,
                customer_id: true,
            },
        }),
    ]);
    const invoiceById = new Map(invoices.map((row) => [row.id, row]));
    const paymentsByInvoice = new Map();
    for (const payment of linkedPayments) {
        if (payment.invoice_id == null)
            continue;
        const list = paymentsByInvoice.get(payment.invoice_id) ?? [];
        list.push(payment);
        paymentsByInvoice.set(payment.invoice_id, list);
    }
    const touchedInvoiceIds = new Set();
    const inserts = [];
    const updates = [];
    const deleteIds = [];
    const now = new Date();
    for (const candidate of byInvoice.values()) {
        const invoice = invoiceById.get(candidate.invoiceId);
        if (!invoice)
            continue;
        const linked = paymentsByInvoice.get(candidate.invoiceId) ?? [];
        const virtualRef = buildVirtualPaymentReference(candidate.invoiceNumber);
        const existingVirtual = linked.find((row) => row.reference === virtualRef ||
            (row.payment_method ?? "").trim() === exports.VIRTUAL_PAYMENT_METHOD) ?? null;
        let realCustomerPaid = 0;
        for (const payment of linked) {
            if (existingVirtual && payment.id === existingVirtual.id) {
                continue;
            }
            if ((payment.payment_method ?? "").trim() === exports.VIRTUAL_PAYMENT_METHOD) {
                continue;
            }
            realCustomerPaid += payment.customer_amount ?? 0;
        }
        const net = invoice.customer_net_amount ?? invoice.customer_amount ?? 0;
        const remaining = net - realCustomerPaid;
        touchedInvoiceIds.add(candidate.invoiceId);
        if (remaining > invoicePaidTolerance_1.INVOICE_PAID_TOLERANCE) {
            const amounts = resolveVirtualAmounts(invoice, remaining);
            if (existingVirtual) {
                updates.push({
                    id: existingVirtual.id,
                    data: {
                        amount: amounts.amount,
                        customer_amount: amounts.customer_amount,
                        customer_currency: amounts.customer_currency,
                        payment_date: candidate.paymentDate,
                        payment_method: exports.VIRTUAL_PAYMENT_METHOD,
                        reference: virtualRef,
                        invoice_id: candidate.invoiceId,
                        invoice_number: candidate.invoiceNumber,
                        modified_by: userId ?? null,
                        modified_at: now,
                    },
                });
            }
            else {
                inserts.push({
                    invoice_id: candidate.invoiceId,
                    invoice_number: candidate.invoiceNumber,
                    amount: amounts.amount,
                    customer_amount: amounts.customer_amount,
                    customer_currency: amounts.customer_currency,
                    payment_date: candidate.paymentDate,
                    payment_method: exports.VIRTUAL_PAYMENT_METHOD,
                    reference: virtualRef,
                    customer_id: candidate.customerId,
                    account_id: accountId,
                    created_by: userId ?? null,
                    modified_by: userId ?? null,
                });
            }
        }
        else if (existingVirtual) {
            deleteIds.push(existingVirtual.id);
        }
    }
    if (inserts.length > 0) {
        await prisma.invoicePayment.createMany({ data: inserts });
    }
    if (updates.length > 0) {
        await (0, bulkWrite_1.commitOps)(prisma, updates.map((row) => prisma.invoicePayment.update({
            where: { id: row.id },
            data: row.data,
        })));
    }
    if (deleteIds.length > 0) {
        await prisma.invoicePayment.deleteMany({
            where: { id: { in: deleteIds }, account_id: accountId },
        });
    }
    return touchedInvoiceIds;
}
