"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importPayments = importPayments;
const connectorPaymentSynthetics_1 = require("../payment/connectorPaymentSynthetics");
const linkDeferredPaymentAndRecalc_1 = require("../invoice/linkDeferredPaymentAndRecalc");
const bulkWrite_1 = require("./bulkWrite");
const account_10149_1 = require("../extensions/account_10149");
const resolvePaymentImportAmounts_1 = require("./resolvePaymentImportAmounts");
function resolveDeferredPaymentAmounts(record) {
    const customer_amount = record.customer_amount;
    const customer_currency = record.customer_currency.trim();
    if (record.amount !== undefined && Number.isFinite(record.amount)) {
        return { amount: record.amount, customer_amount, customer_currency };
    }
    return { amount: customer_amount, customer_amount, customer_currency };
}
function sameCalendarDay(a, b) {
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
/** InvoicePayment amounts are Postgres Real (float32); ERP values are JS float64. */
function sameRealAmount(existing, next) {
    return existing === next || Math.fround(existing) === Math.fround(next);
}
function isUnchangedPayment(existing, next) {
    const existingInvoiceNumber = (existing.invoice_number ?? "").trim();
    const nextInvoiceNumber = next.invoice_number.trim();
    const sameLink = existing.invoice_id === next.invoice_id;
    return (sameRealAmount(existing.amount, next.amount) &&
        sameRealAmount(existing.customer_amount, next.customer_amount) &&
        existing.customer_currency === next.customer_currency &&
        sameCalendarDay(existing.payment_date, next.payment_date) &&
        existing.reference === next.reference &&
        sameLink &&
        existingInvoiceNumber === nextInvoiceNumber &&
        (existing.payment_method ?? "") === next.payment_method);
}
function erpRowFromRecord(record) {
    return record._rawRecord ?? record;
}
function asNonEmptyString(value) {
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function isIdigitalPaymentRow(raw) {
    const fncnum = asNonEmptyString(raw.FNCNUM);
    const fnciref1 = asNonEmptyString(raw.FNCIREF1);
    const freconnum = raw.FRECONNUM;
    const hasFreconnum = (typeof freconnum === "string" && freconnum.trim().length > 0) ||
        typeof freconnum === "number";
    return (fncnum != null && fnciref1 != null) || hasFreconnum;
}
function matchExistingPayment(rows, uniqueAliases, rawReference, targetInvoiceNumber, effectiveReference) {
    const exact = rows.find((row) => row.reference === effectiveReference);
    if (exact)
        return exact;
    for (const alias of uniqueAliases) {
        if (!alias.includes("|") || alias === effectiveReference)
            continue;
        const hit = rows.find((row) => row.reference === alias);
        if (hit)
            return hit;
    }
    if (targetInvoiceNumber) {
        const byRawAndInvoice = rows.find((row) => row.reference === rawReference &&
            (row.invoice_number ?? "").trim() === targetInvoiceNumber);
        if (byRawAndInvoice)
            return byRawAndInvoice;
    }
    const aliasSet = new Set(uniqueAliases);
    return rows.find((row) => aliasSet.has(row.reference)) ?? null;
}
async function importPayments(prisma, paymentRecords, accountId, userId) {
    const results = paymentRecords.map((_, index) => ({
        index,
        success: false,
    }));
    const customerNumbers = [
        ...new Set(paymentRecords.map((p) => p.customer_number)),
    ];
    const customers = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            customer_number: { in: customerNumbers },
        },
        select: { id: true, customer_number: true },
    });
    const customerByNumber = new Map();
    for (const c of customers) {
        if (c.customer_number) {
            customerByNumber.set(c.customer_number, c.id);
        }
    }
    const prepared = [];
    for (let i = 0; i < paymentRecords.length; i++) {
        const record = { ...paymentRecords[i], account_id: accountId };
        const customerId = customerByNumber.get(record.customer_number);
        if (customerId === undefined) {
            results[i] = {
                index: i,
                success: false,
                message: `Customer ${record.customer_number} not found`,
            };
            continue;
        }
        if (!record.reference) {
            results[i] = {
                index: i,
                success: false,
                message: "Reference ID is required",
            };
            continue;
        }
        const targetInvoiceNumber = record.invoice_number?.trim() ||
            asNonEmptyString(record.FNCIREF1) ||
            "";
        const rawReference = record.reference.trim();
        const shouldCompositeRef = targetInvoiceNumber.length > 0 &&
            !rawReference.includes("|") &&
            rawReference !== targetInvoiceNumber;
        const effectiveReference = shouldCompositeRef
            ? `${rawReference}|${targetInvoiceNumber}`
            : rawReference;
        record.reference = effectiveReference;
        const aliases = (0, connectorPaymentSynthetics_1.collectPaymentReferenceAliases)(erpRowFromRecord(record), effectiveReference, targetInvoiceNumber);
        prepared.push({
            index: i,
            record,
            customerId,
            rawReference,
            effectiveReference,
            uniqueAliases: aliases.length > 0 ? aliases : [effectiveReference],
            targetInvoiceNumber,
            paymentDate: new Date(record.payment_date),
            paymentMethod: record.payment_method ?? "",
        });
    }
    const winners = (0, bulkWrite_1.lastWinsByKey)(prepared, (row) => `${row.customerId}::${row.effectiveReference}`);
    if (winners.length === 0) {
        return results;
    }
    const customerIds = [...new Set(winners.map((row) => row.customerId))];
    const invoiceNumbers = [
        ...new Set(winners
            .map((row) => row.targetInvoiceNumber)
            .filter((n) => n.length > 0)),
    ];
    const allAliases = [
        ...new Set(winners.flatMap((row) => row.uniqueAliases)),
    ];
    const [invoices, existingPayments] = await Promise.all([
        invoiceNumbers.length === 0
            ? Promise.resolve([])
            : prisma.invoice.findMany({
                where: {
                    invoice_number: { in: invoiceNumbers },
                    customer_id: { in: customerIds },
                },
                select: {
                    id: true,
                    amount: true,
                    customer_amount: true,
                    customer_currency: true,
                    invoice_number: true,
                    custom_code1: true,
                    customer_id: true,
                },
            }),
        customerIds.length === 0
            ? Promise.resolve([])
            : prisma.invoicePayment.findMany({
                where: {
                    account_id: accountId,
                    customer_id: { in: customerIds },
                    OR: [
                        { reference: { in: allAliases } },
                        ...(invoiceNumbers.length > 0
                            ? [{ invoice_number: { in: invoiceNumbers } }]
                            : []),
                    ],
                },
                select: {
                    id: true,
                    reference: true,
                    amount: true,
                    customer_amount: true,
                    customer_currency: true,
                    payment_date: true,
                    invoice_id: true,
                    invoice_number: true,
                    payment_method: true,
                    customer_id: true,
                },
            }),
    ]);
    const invoiceByCustomerNumber = new Map();
    for (const invoice of invoices) {
        if (invoice.invoice_number && invoice.customer_id != null) {
            invoiceByCustomerNumber.set(`${invoice.customer_id}::${invoice.invoice_number}`, invoice);
        }
    }
    const existingByCustomer = new Map();
    for (const row of existingPayments) {
        const list = existingByCustomer.get(row.customer_id) ?? [];
        list.push(row);
        existingByCustomer.set(row.customer_id, list);
    }
    const inserts = [];
    const updates = [];
    const createdMeta = [];
    const skippedIds = new Map();
    const failedIds = new Map();
    const invoiceIdsToRecalc = new Map();
    const markRecalc = (invoiceId, normalizeNegative) => {
        if (invoiceId == null)
            return;
        const prev = invoiceIdsToRecalc.get(invoiceId) ?? {};
        invoiceIdsToRecalc.set(invoiceId, {
            normalizeNegativePaymentsForCreditClose: prev.normalizeNegativePaymentsForCreditClose === true ||
                normalizeNegative === true,
        });
    };
    for (const winner of winners) {
        const key = `${winner.customerId}::${winner.effectiveReference}`;
        const existingPayment = matchExistingPayment(existingByCustomer.get(winner.customerId) ?? [], winner.uniqueAliases, winner.rawReference, winner.targetInvoiceNumber, winner.effectiveReference);
        const invoice = invoiceByCustomerNumber.get(`${winner.customerId}::${winner.targetInvoiceNumber}`);
        if (!invoice) {
            const deferredAmounts = resolveDeferredPaymentAmounts(winner.record);
            const nextSnapshot = {
                amount: deferredAmounts.amount,
                customer_amount: deferredAmounts.customer_amount,
                customer_currency: deferredAmounts.customer_currency,
                payment_date: winner.paymentDate,
                reference: winner.effectiveReference,
                invoice_id: existingPayment?.invoice_id ?? null,
                invoice_number: winner.targetInvoiceNumber,
                payment_method: winner.paymentMethod,
            };
            if (existingPayment) {
                if (isUnchangedPayment(existingPayment, nextSnapshot)) {
                    skippedIds.set(key, {
                        index: winner.index,
                        success: true,
                        skipped: true,
                        invoicePaymentId: existingPayment.id,
                        customerId: winner.customerId,
                        message: "import.results.paymentSkipped",
                    });
                    continue;
                }
                updates.push({
                    id: existingPayment.id,
                    previousInvoiceId: existingPayment.invoice_id,
                    newInvoiceId: existingPayment.invoice_id,
                    winner,
                    deferred: existingPayment.invoice_id == null,
                    data: {
                        invoice_id: existingPayment.invoice_id,
                        invoice_number: winner.targetInvoiceNumber || null,
                        customer_currency: deferredAmounts.customer_currency,
                        payment_date: winner.paymentDate,
                        amount: deferredAmounts.amount,
                        payment_method: winner.paymentMethod,
                        reference: winner.effectiveReference,
                        customer_amount: deferredAmounts.customer_amount,
                        modified_by: userId ?? null,
                        modified_at: new Date(),
                    },
                });
                continue;
            }
            inserts.push({
                invoice_id: null,
                invoice_number: winner.targetInvoiceNumber || null,
                customer_currency: deferredAmounts.customer_currency,
                payment_date: winner.paymentDate,
                amount: deferredAmounts.amount,
                payment_method: winner.paymentMethod,
                reference: winner.record.reference,
                customer_id: winner.customerId,
                account_id: accountId,
                customer_amount: deferredAmounts.customer_amount,
                created_by: userId ?? null,
                modified_by: userId ?? null,
            });
            createdMeta.push({
                winner,
                deferred: true,
                invoiceId: null,
            });
            continue;
        }
        const amountResolution = (0, resolvePaymentImportAmounts_1.resolvePaymentImportAmounts)({
            amount: winner.record.amount,
            customer_amount: winner.record.customer_amount,
            customer_currency: winner.record.customer_currency,
        }, {
            amount: invoice.amount,
            customer_amount: invoice.customer_amount,
            customer_currency: invoice.customer_currency,
        }, accountId === account_10149_1.ACCOUNT_10149_ID
            ? { normalizeCurrency: account_10149_1.normalizeAccount10149PaymentCurrency }
            : undefined);
        if (!amountResolution.ok) {
            failedIds.set(key, {
                index: winner.index,
                success: false,
                message: amountResolution.errorKey,
            });
            continue;
        }
        const rawErpRow = erpRowFromRecord(winner.record);
        const normalizeNegative = isIdigitalPaymentRow(rawErpRow) &&
            invoice.custom_code1 === "C" &&
            amountResolution.customer_amount < 0;
        const nextSnapshot = {
            amount: amountResolution.amount,
            customer_amount: amountResolution.customer_amount,
            customer_currency: amountResolution.customer_currency,
            payment_date: winner.paymentDate,
            reference: winner.effectiveReference,
            invoice_id: invoice.id,
            invoice_number: winner.targetInvoiceNumber,
            payment_method: winner.paymentMethod,
        };
        if (existingPayment) {
            if (isUnchangedPayment(existingPayment, nextSnapshot)) {
                skippedIds.set(key, {
                    index: winner.index,
                    success: true,
                    skipped: true,
                    invoicePaymentId: existingPayment.id,
                    customerId: winner.customerId,
                    message: "import.results.paymentSkipped",
                });
                continue;
            }
            updates.push({
                id: existingPayment.id,
                previousInvoiceId: existingPayment.invoice_id,
                newInvoiceId: invoice.id,
                winner,
                deferred: false,
                normalizeNegative,
                data: {
                    invoice_id: invoice.id,
                    invoice_number: winner.targetInvoiceNumber || null,
                    customer_currency: amountResolution.customer_currency,
                    payment_date: winner.paymentDate,
                    amount: amountResolution.amount,
                    payment_method: winner.paymentMethod,
                    reference: winner.effectiveReference,
                    customer_amount: amountResolution.customer_amount,
                    modified_by: userId ?? null,
                    modified_at: new Date(),
                },
            });
            continue;
        }
        inserts.push({
            invoice_id: invoice.id,
            invoice_number: winner.targetInvoiceNumber || null,
            amount: amountResolution.amount,
            payment_date: winner.paymentDate,
            payment_method: winner.paymentMethod,
            reference: winner.record.reference,
            customer_id: winner.customerId,
            account_id: accountId,
            customer_currency: amountResolution.customer_currency,
            customer_amount: amountResolution.customer_amount,
            created_by: userId ?? null,
            modified_by: userId ?? null,
        });
        createdMeta.push({
            winner,
            deferred: false,
            invoiceId: invoice.id,
            normalizeNegative,
        });
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
    const createdPayments = inserts.length === 0
        ? []
        : await prisma.invoicePayment.findMany({
            where: {
                account_id: accountId,
                reference: {
                    in: createdMeta.map((row) => row.winner.effectiveReference),
                },
                customer_id: { in: customerIds },
            },
            select: { id: true, reference: true, customer_id: true },
        });
    const createdIdByKey = new Map();
    for (const row of createdPayments) {
        createdIdByKey.set(`${row.customer_id}::${row.reference}`, row.id);
    }
    const winnerResult = new Map();
    for (const [key, skipped] of skippedIds) {
        winnerResult.set(key, skipped);
    }
    for (const [key, failed] of failedIds) {
        winnerResult.set(key, failed);
    }
    for (const row of createdMeta) {
        const key = `${row.winner.customerId}::${row.winner.effectiveReference}`;
        const invoicePaymentId = createdIdByKey.get(key);
        winnerResult.set(key, {
            index: row.winner.index,
            success: true,
            deferred: row.deferred,
            invoicePaymentId,
            customerId: row.winner.customerId,
            message: row.deferred ? "import.results.paymentDeferred" : undefined,
        });
        markRecalc(row.invoiceId, row.normalizeNegative);
    }
    for (const row of updates) {
        const key = `${row.winner.customerId}::${row.winner.effectiveReference}`;
        winnerResult.set(key, {
            index: row.winner.index,
            success: true,
            deferred: row.deferred,
            invoicePaymentId: row.id,
            customerId: row.winner.customerId,
            message: row.deferred ? "import.results.paymentDeferred" : undefined,
        });
        markRecalc(row.previousInvoiceId, row.normalizeNegative);
        markRecalc(row.newInvoiceId, row.normalizeNegative);
    }
    await (0, linkDeferredPaymentAndRecalc_1.recalculateInvoicesFromLinkedPayments)(prisma, invoiceIdsToRecalc);
    for (const row of prepared) {
        const key = `${row.customerId}::${row.effectiveReference}`;
        const winner = winnerResult.get(key);
        if (winner) {
            results[row.index] = { ...winner, index: row.index };
        }
    }
    return results;
}
