"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importPayments = importPayments;
const connectorPaymentSynthetics_1 = require("../payment/connectorPaymentSynthetics");
const paymentWriteService_1 = require("./paymentWriteService");
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
function isUnchangedPayment(existing, next) {
    const existingInvoiceNumber = (existing.invoice_number ?? "").trim();
    const nextInvoiceNumber = next.invoice_number.trim();
    return (existing.amount === next.amount &&
        existing.customer_amount === next.customer_amount &&
        existing.customer_currency === next.customer_currency &&
        sameCalendarDay(existing.payment_date, next.payment_date) &&
        existing.reference === next.reference &&
        existing.invoice_id === next.invoice_id &&
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
async function importPayments(prisma, paymentRecords, accountId, userId) {
    const customerNumbers = [...new Set(paymentRecords.map((p) => p.customer_number))];
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
    const results = [];
    for (let i = 0; i < paymentRecords.length; i++) {
        const record = { ...paymentRecords[i], account_id: accountId };
        const customerId = customerByNumber.get(record.customer_number);
        if (customerId === undefined) {
            results.push({
                index: i,
                success: false,
                message: `Customer ${record.customer_number} not found`,
            });
            continue;
        }
        const resolvedCustomerId = customerId;
        if (!record.reference) {
            results.push({
                index: i,
                success: false,
                message: "Reference ID is required",
            });
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
        const uniqueAliases = aliases.length > 0 ? aliases : [effectiveReference];
        const existingPayment = (await prisma.invoicePayment.findFirst({
            where: {
                account_id: record.account_id,
                customer_id: resolvedCustomerId,
                OR: targetInvoiceNumber
                    ? [
                        { reference: { in: uniqueAliases } },
                        {
                            reference: rawReference,
                            invoice_number: targetInvoiceNumber,
                        },
                    ]
                    : [{ reference: { in: uniqueAliases } }],
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
            },
        }));
        const invoice = await prisma.invoice.findFirst({
            where: {
                invoice_number: targetInvoiceNumber,
                customer_id: resolvedCustomerId,
            },
            select: {
                id: true,
                amount: true,
                customer_amount: true,
                customer_currency: true,
                invoice_number: true,
                priority_erp_debit: true,
            },
        });
        if (!invoice) {
            const deferredAmounts = resolveDeferredPaymentAmounts(record);
            const paymentDate = new Date(record.payment_date);
            const paymentMethod = record.payment_method ?? "";
            if (existingPayment) {
                if (isUnchangedPayment(existingPayment, {
                    amount: deferredAmounts.amount,
                    customer_amount: deferredAmounts.customer_amount,
                    customer_currency: deferredAmounts.customer_currency,
                    payment_date: paymentDate,
                    reference: effectiveReference,
                    invoice_id: null,
                    invoice_number: record.invoice_number,
                    payment_method: paymentMethod,
                })) {
                    results.push({
                        index: i,
                        success: true,
                        skipped: true,
                        invoicePaymentId: existingPayment.id,
                        customerId: resolvedCustomerId,
                        message: "import.results.paymentSkipped",
                    });
                    continue;
                }
                try {
                    const { invoicePayment } = await (0, paymentWriteService_1.updateInvoicePayment)(prisma, {
                        id: existingPayment.id,
                        invoice_id: null,
                        invoice_number: record.invoice_number,
                        amount: deferredAmounts.amount,
                        customer_amount: deferredAmounts.customer_amount,
                        customer_currency: deferredAmounts.customer_currency,
                        payment_date: paymentDate,
                        payment_method: paymentMethod,
                        reference: effectiveReference,
                        customer_id: resolvedCustomerId,
                        account_id: record.account_id,
                        modified_by: userId ?? null,
                    });
                    results.push({
                        index: i,
                        success: true,
                        deferred: true,
                        invoicePaymentId: invoicePayment.id,
                        customerId: resolvedCustomerId,
                        message: "import.results.paymentDeferred",
                    });
                }
                catch (err) {
                    results.push({
                        index: i,
                        success: false,
                        message: err instanceof Error ? err.message : "Unknown error",
                    });
                }
                continue;
            }
            try {
                const deferredPayment = await (0, paymentWriteService_1.createDeferredInvoicePayment)(prisma, {
                    invoice_number: record.invoice_number,
                    amount: deferredAmounts.amount,
                    payment_date: paymentDate,
                    payment_method: paymentMethod,
                    reference: record.reference,
                    customer_id: resolvedCustomerId,
                    account_id: record.account_id,
                    customer_currency: deferredAmounts.customer_currency,
                    customer_amount: deferredAmounts.customer_amount,
                    created_by: userId ?? null,
                    modified_by: userId ?? null,
                });
                results.push({
                    index: i,
                    success: true,
                    deferred: true,
                    invoicePaymentId: deferredPayment.id,
                    customerId: resolvedCustomerId,
                    message: "import.results.paymentDeferred",
                });
            }
            catch (err) {
                results.push({
                    index: i,
                    success: false,
                    message: err instanceof Error ? err.message : "Unknown error",
                });
            }
            continue;
        }
        const amountResolution = (0, resolvePaymentImportAmounts_1.resolvePaymentImportAmounts)({
            amount: record.amount,
            customer_amount: record.customer_amount,
            customer_currency: record.customer_currency,
        }, {
            amount: invoice.amount,
            customer_amount: invoice.customer_amount,
            customer_currency: invoice.customer_currency,
        });
        if (!amountResolution.ok) {
            results.push({
                index: i,
                success: false,
                message: amountResolution.errorKey,
            });
            continue;
        }
        const paymentDate = new Date(record.payment_date);
        const paymentMethod = record.payment_method ?? "";
        const rawErpRow = erpRowFromRecord(record);
        const normalizeNegativePaymentsForCreditClose = isIdigitalPaymentRow(rawErpRow) &&
            invoice.priority_erp_debit === "C" &&
            amountResolution.customer_amount < 0;
        const paymentWriteOptions = normalizeNegativePaymentsForCreditClose
            ? { normalizeNegativePaymentsForCreditClose: true }
            : undefined;
        const nextSnapshot = {
            amount: amountResolution.amount,
            customer_amount: amountResolution.customer_amount,
            customer_currency: amountResolution.customer_currency,
            payment_date: paymentDate,
            reference: effectiveReference,
            invoice_id: invoice.id,
            invoice_number: targetInvoiceNumber,
            payment_method: paymentMethod,
        };
        try {
            if (existingPayment) {
                if (isUnchangedPayment(existingPayment, nextSnapshot)) {
                    results.push({
                        index: i,
                        success: true,
                        skipped: true,
                        invoicePaymentId: existingPayment.id,
                        customerId: resolvedCustomerId,
                        message: "import.results.paymentSkipped",
                    });
                    continue;
                }
                const { invoicePayment } = await (0, paymentWriteService_1.updateInvoicePayment)(prisma, {
                    id: existingPayment.id,
                    invoice_id: invoice.id,
                    invoice_number: record.invoice_number,
                    amount: amountResolution.amount,
                    customer_amount: amountResolution.customer_amount,
                    customer_currency: amountResolution.customer_currency,
                    payment_date: paymentDate,
                    payment_method: paymentMethod,
                    reference: effectiveReference,
                    customer_id: resolvedCustomerId,
                    account_id: record.account_id,
                    modified_by: userId ?? null,
                }, paymentWriteOptions);
                results.push({
                    index: i,
                    success: true,
                    invoicePaymentId: invoicePayment.id,
                    customerId: resolvedCustomerId,
                });
                continue;
            }
            const { invoicePayment } = await (0, paymentWriteService_1.createLinkedInvoicePayment)(prisma, {
                invoice_id: invoice.id,
                invoice_number: record.invoice_number,
                amount: amountResolution.amount,
                payment_date: paymentDate,
                payment_method: paymentMethod,
                reference: record.reference,
                customer_id: resolvedCustomerId,
                account_id: record.account_id,
                customer_currency: amountResolution.customer_currency,
                customer_amount: amountResolution.customer_amount,
                created_by: userId ?? null,
                modified_by: userId ?? null,
            }, paymentWriteOptions);
            results.push({
                index: i,
                success: true,
                invoicePaymentId: invoicePayment.id,
                customerId: resolvedCustomerId,
            });
        }
        catch (err) {
            results.push({
                index: i,
                success: false,
                message: err instanceof Error ? err.message : "Unknown error",
            });
        }
    }
    return results;
}
