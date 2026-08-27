"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rawErpRowFromMaturedPayment = rawErpRowFromMaturedPayment;
exports.applyMaturedDeferredPayments = applyMaturedDeferredPayments;
const extensions_1 = require("../extensions");
const linkDeferredPaymentAndRecalc_1 = require("../invoice/linkDeferredPaymentAndRecalc");
const UPDATE_MANY_ID_CHUNK = 500;
/**
 * Rebuild a minimal ERP-shaped row for extension hooks after maturity.
 * When reference is FRECONNUM|FNCNUM|KLINE, treat as reconciled (BAL=0).
 * Without a leading recon segment, afterPaymentLinked recon checks no-op.
 */
function rawErpRowFromMaturedPayment(payment) {
    const parts = payment.reference
        .split("|")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    const raw = {
        FNCIREF1: payment.invoice_number,
        PAY_INVOICE_NUMBER: payment.invoice_number,
        CREDIT1: payment.customer_amount,
        BAL: 0,
    };
    if (parts.length >= 3 && /^\d+$/.test(parts[0])) {
        raw.FRECONNUM = Number(parts[0]);
        raw.FNCNUM = parts[1];
        raw.KLINE = parts[2];
    }
    return raw;
}
/**
 * Link deferred payments whose invoice now exists and whose payment_date has
 * matured. Groups links with updateMany per invoice_id, runs extension
 * afterPaymentLinked (virtual recon close), then batch-recalcs paid totals.
 */
async function applyMaturedDeferredPayments(prisma, accountId, asOf, invoiceNumbers, options) {
    const scopedNumbers = invoiceNumbers == null
        ? null
        : Array.from(new Set(invoiceNumbers.filter((n) => Boolean(n?.trim()))));
    if (scopedNumbers && scopedNumbers.length === 0) {
        return {
            matured: 0,
            deferredRemaining: 0,
            totalCandidates: 0,
            affectedCustomerIds: [],
        };
    }
    const deferredRows = await prisma.invoicePayment.findMany({
        where: {
            account_id: accountId,
            invoice_id: null,
            payment_date: { lte: asOf },
            invoice_number: scopedNumbers == null
                ? { not: null }
                : { in: scopedNumbers },
        },
        select: {
            id: true,
            invoice_number: true,
            customer_id: true,
            reference: true,
            customer_amount: true,
            payment_date: true,
        },
    });
    const totalCandidates = deferredRows.length;
    options?.onProgress?.({ linked: 0, totalCandidates });
    if (deferredRows.length === 0) {
        const stillDeferred = await prisma.invoicePayment.count({
            where: { account_id: accountId, invoice_id: null },
        });
        return {
            matured: 0,
            deferredRemaining: stillDeferred,
            totalCandidates: 0,
            affectedCustomerIds: [],
        };
    }
    const customerIds = [
        ...new Set(deferredRows.map((row) => row.customer_id)),
    ];
    const deferredInvoiceNumbers = [
        ...new Set(deferredRows
            .map((row) => row.invoice_number)
            .filter((n) => Boolean(n))),
    ];
    const invoices = customerIds.length === 0 || deferredInvoiceNumbers.length === 0
        ? []
        : await prisma.invoice.findMany({
            where: {
                account_id: accountId,
                customer_id: { in: customerIds },
                invoice_number: { in: deferredInvoiceNumbers },
            },
            select: {
                id: true,
                customer_id: true,
                invoice_number: true,
            },
        });
    const invoiceByCustomerAndNumber = new Map();
    for (const invoice of invoices) {
        if (!invoice.invoice_number)
            continue;
        invoiceByCustomerAndNumber.set(`${invoice.customer_id}::${invoice.invoice_number}`, invoice.id);
    }
    const now = new Date();
    const paymentIdsByInvoiceId = new Map();
    const linkCandidates = [];
    for (const row of deferredRows) {
        if (!row.invoice_number)
            continue;
        const invoiceId = invoiceByCustomerAndNumber.get(`${row.customer_id}::${row.invoice_number}`);
        if (invoiceId == null)
            continue;
        const list = paymentIdsByInvoiceId.get(invoiceId) ?? [];
        list.push(row.id);
        paymentIdsByInvoiceId.set(invoiceId, list);
        linkCandidates.push({
            invoiceId,
            customerId: row.customer_id,
            invoiceNumber: row.invoice_number,
            paymentDate: row.payment_date,
            rawErpRow: rawErpRowFromMaturedPayment({
                reference: row.reference,
                customer_amount: row.customer_amount,
                invoice_number: row.invoice_number,
            }),
        });
    }
    let matured = 0;
    let lastProgressAt = 0;
    const emitProgress = (force = false) => {
        const nowMs = Date.now();
        if (!force &&
            nowMs - lastProgressAt < 250 &&
            matured < totalCandidates) {
            return;
        }
        lastProgressAt = nowMs;
        options?.onProgress?.({ linked: matured, totalCandidates });
    };
    const invoiceIdsToRecalc = new Map();
    if (paymentIdsByInvoiceId.size > 0) {
        for (const [invoiceId, paymentIds] of paymentIdsByInvoiceId) {
            for (let offset = 0; offset < paymentIds.length; offset += UPDATE_MANY_ID_CHUNK) {
                const idChunk = paymentIds.slice(offset, offset + UPDATE_MANY_ID_CHUNK);
                const updated = await prisma.invoicePayment.updateMany({
                    where: {
                        account_id: accountId,
                        invoice_id: null,
                        id: { in: idChunk },
                    },
                    data: {
                        invoice_id: invoiceId,
                        modified_at: now,
                    },
                });
                matured += updated.count;
                emitProgress();
            }
            invoiceIdsToRecalc.set(invoiceId, {});
        }
        emitProgress(true);
        const extension = await (0, extensions_1.resolveAccountBillingExtension)(prisma, accountId);
        if (extension?.afterPaymentLinked && linkCandidates.length > 0) {
            const { invoiceIdsToRecalc: extensionRecalcIds } = await extension.afterPaymentLinked({
                prisma,
                accountId,
                userId: options?.userId,
                candidates: linkCandidates,
            });
            for (const invoiceId of extensionRecalcIds) {
                invoiceIdsToRecalc.set(invoiceId, {});
            }
        }
        await (0, linkDeferredPaymentAndRecalc_1.recalculateInvoicesFromLinkedPayments)(prisma, invoiceIdsToRecalc);
    }
    const stillDeferred = await prisma.invoicePayment.count({
        where: { account_id: accountId, invoice_id: null },
    });
    const affectedCustomerIds = invoiceIdsToRecalc.size > 0
        ? Array.from(new Set(linkCandidates.map((candidate) => candidate.customerId)))
        : [];
    return {
        matured,
        deferredRemaining: stillDeferred,
        totalCandidates,
        affectedCustomerIds,
    };
}
