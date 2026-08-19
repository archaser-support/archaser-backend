"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyMaturedDeferredPayments = applyMaturedDeferredPayments;
const linkDeferredPaymentAndRecalc_1 = require("../invoice/linkDeferredPaymentAndRecalc");
async function applyMaturedDeferredPayments(prisma, accountId, asOf) {
    const deferredRows = await prisma.invoicePayment.findMany({
        where: {
            account_id: accountId,
            invoice_id: null,
            payment_date: { lte: asOf },
            invoice_number: { not: null },
        },
        select: {
            id: true,
            invoice_number: true,
            customer_id: true,
        },
    });
    if (deferredRows.length === 0) {
        const stillDeferred = await prisma.invoicePayment.count({
            where: { account_id: accountId, invoice_id: null },
        });
        return { matured: 0, deferredRemaining: stillDeferred };
    }
    let matured = 0;
    for (const row of deferredRows) {
        if (!row.invoice_number)
            continue;
        const invoice = await prisma.invoice.findFirst({
            where: {
                account_id: accountId,
                customer_id: row.customer_id,
                invoice_number: row.invoice_number,
            },
            select: { id: true },
        });
        if (!invoice)
            continue;
        const result = await (0, linkDeferredPaymentAndRecalc_1.linkDeferredPaymentAndRecalc)(prisma, {
            invoicePaymentId: row.id,
            invoiceId: invoice.id,
        });
        if (!result.alreadyLinked) {
            matured += 1;
        }
    }
    const stillDeferred = await prisma.invoicePayment.count({
        where: { account_id: accountId, invoice_id: null },
    });
    return { matured, deferredRemaining: stillDeferred };
}
