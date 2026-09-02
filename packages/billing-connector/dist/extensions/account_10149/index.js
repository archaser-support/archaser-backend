"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.account10149Extension = exports.USD_CURRENCY_CODE = exports.ILS_CURRENCY_CODE = exports.ACCOUNT_10149_ID = exports.ACCOUNT_10149_EXTENSION_KEY = void 0;
exports.isHebrewShekelCurrencyLabel = isHebrewShekelCurrencyLabel;
exports.isDollarCurrencyLabel = isDollarCurrencyLabel;
exports.normalizeAccount10149PaymentCurrency = normalizeAccount10149PaymentCurrency;
exports.alignAccount10149PaymentAmountsForInvoice = alignAccount10149PaymentAmountsForInvoice;
exports.isAccount10149DebitPaymentRow = isAccount10149DebitPaymentRow;
exports.isAccount10149CancelDebitPaymentRow = isAccount10149CancelDebitPaymentRow;
exports.isAccount10149HelamOffsetCancelRow = isAccount10149HelamOffsetCancelRow;
exports.collectHelamOffsetPairTargets = collectHelamOffsetPairTargets;
exports.isAccount10149ReconciledClose = isAccount10149ReconciledClose;
exports.isAccount10149ReconciledReceiptClose = isAccount10149ReconciledReceiptClose;
exports.isAccount10149CreditInvoiceNumber = isAccount10149CreditInvoiceNumber;
exports.transformAccount10149Batch = transformAccount10149Batch;
exports.afterAccount10149PaymentLinked = afterAccount10149PaymentLinked;
const pendingCloseProgress_1 = require("../pendingCloseProgress");
const connectorFieldUtils_1 = require("../../utils/connectorFieldUtils");
const alignPaymentToInvoiceCurrency_1 = require("../../payment/alignPaymentToInvoiceCurrency");
const helamOffsetClose_1 = require("./helamOffsetClose");
const reconciledVirtualClose_1 = require("./reconciledVirtualClose");
/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon virtual close, Helam offset stamp. */
exports.ACCOUNT_10149_EXTENSION_KEY = "account_10149";
exports.ACCOUNT_10149_ID = 10149;
exports.ILS_CURRENCY_CODE = "ILS";
exports.USD_CURRENCY_CODE = "USD";
const INVOICE_AMOUNT_FIELDS = [
    "amount",
    "customer_amount",
    "base_amount",
    "invoice_amount",
];
const CURRENCY_FIELDS = ["currency", "customer_currency"];
/** Quote marks seen in Hebrew shekel abbreviations (ASCII, typographic, geresh). */
const SHEKEL_QUOTE_CHARS = /['"‘’“”׳״`]/g;
function rawRecordOf(row) {
    const raw = row._rawRecord;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw;
    }
    return {};
}
function isCreditInvoiceRow(row) {
    const raw = rawRecordOf(row);
    const debit = row.custom_code1 ??
        row.DEBIT ??
        row.debit ??
        raw.custom_code1 ??
        raw.DEBIT ??
        raw.debit;
    return typeof debit === "string" && debit.trim().toUpperCase() === "C";
}
function toFiniteNumber(value) {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function negateCreditInvoiceAmounts(row) {
    const next = { ...row };
    for (const field of INVOICE_AMOUNT_FIELDS) {
        const parsed = toFiniteNumber(next[field]);
        if (parsed !== undefined) {
            next[field] = parsed * -1;
        }
    }
    return next;
}
function shekelLettersOf(value) {
    return value.trim().replace(/\s+/g, "").replace(SHEKEL_QUOTE_CHARS, "");
}
function isHebrewShekelCurrencyLabel(value) {
    return typeof value === "string" && shekelLettersOf(value) === "שח";
}
/** Priority dollar symbol (and common US$ / USD$ variants) → USD. */
function isDollarCurrencyLabel(value) {
    if (typeof value !== "string") {
        return false;
    }
    const trimmed = value.trim().replace(/\s+/g, "").toUpperCase();
    return trimmed === "$" || trimmed === "US$" || trimmed === "USD$";
}
function normalizeAccount10149PaymentCurrency(currency) {
    if (currency == null) {
        return "";
    }
    if (isHebrewShekelCurrencyLabel(currency)) {
        return exports.ILS_CURRENCY_CODE;
    }
    if (isDollarCurrencyLabel(currency)) {
        return exports.USD_CURRENCY_CODE;
    }
    return currency.trim().toUpperCase();
}
function pickNonZeroAmount(...values) {
    for (const value of values) {
        const n = toFiniteNumber(value);
        if (n !== undefined && n !== 0) {
            return n;
        }
    }
    return null;
}
function roundCurrency(value) {
    return Math.round(value * 100) / 100;
}
/**
 * Priority IDG_ARFNCITEMS4 dual currency:
 * CODE + CREDIT1/DEBIT1 (primary) and CODE5 + CREDIT5/DEBIT5 (secondary).
 * Pick the side matching the invoice currency; keep the other as base amount.
 *
 * Receipt lines (FNCPATNAME "ק") carry only the primary side — Priority books
 * the dual currency on the invoice/debit line — so when neither side matches the
 * invoice we convert the primary amount with the invoice's own FX ratio.
 */
function alignAccount10149PaymentAmountsForInvoice(input) {
    const raw = input.rawErpRow;
    const invoiceCurrency = normalizeAccount10149PaymentCurrency(input.invoiceCustomerCurrency);
    if (!invoiceCurrency) {
        return absAlignedCancelDebitAmounts(raw, {
            amount: input.amount,
            customer_amount: input.customer_amount,
            customer_currency: input.customer_currency,
        });
    }
    const code = normalizeAccount10149PaymentCurrency(raw.CODE ?? input.customer_currency);
    const code5 = normalizeAccount10149PaymentCurrency(raw.CODE5);
    const amount1 = pickNonZeroAmount(raw.CREDIT1, raw.DEBIT1);
    const amount5 = pickNonZeroAmount(raw.CREDIT5, raw.DEBIT5);
    const invoiceCurrencyRaw = (input.invoiceCustomerCurrency ?? "").trim() ||
        input.customer_currency;
    const invoiceFxRatio = (0, alignPaymentToInvoiceCurrency_1.deriveInvoiceFxRatio)(input.invoiceAmount, input.invoiceCustomerAmount);
    // Only the primary side exists (no CODE5) and it is not the invoice currency.
    const needsInvoiceFxConversion = code !== invoiceCurrency &&
        code5 === "" &&
        amount1 !== null &&
        invoiceFxRatio !== null;
    const aligned = code5 === invoiceCurrency && amount5 !== null
        ? {
            amount: amount1 ?? input.amount,
            customer_amount: amount5,
            customer_currency: invoiceCurrencyRaw,
        }
        : code === invoiceCurrency && amount1 !== null
            ? {
                amount: amount5 ?? input.amount ?? amount1,
                customer_amount: amount1,
                customer_currency: invoiceCurrencyRaw,
            }
            : needsInvoiceFxConversion
                ? {
                    amount: amount1,
                    customer_amount: roundCurrency(amount1 / invoiceFxRatio),
                    customer_currency: invoiceCurrencyRaw,
                }
                : {
                    amount: input.amount,
                    customer_amount: input.customer_amount,
                    customer_currency: input.customer_currency,
                };
    return absAlignedCancelDebitAmounts(raw, aligned);
}
/** Keep Helam cancel DEBIT1 from reintroducing a negative customer_amount. */
function absAlignedCancelDebitAmounts(raw, aligned) {
    const credit1 = toFiniteNumber(raw.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1) ?? 0;
    if (!(credit1 === 0 && debit1 < 0)) {
        return aligned;
    }
    return {
        amount: aligned.amount !== undefined
            ? Math.abs(aligned.amount)
            : aligned.amount,
        customer_amount: Math.abs(aligned.customer_amount),
        customer_currency: aligned.customer_currency,
    };
}
function asNonEmptyString(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value !== "string")
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function hasFreconnum(raw) {
    const freconnum = raw.FRECONNUM;
    if (typeof freconnum === "number" && Number.isFinite(freconnum)) {
        return true;
    }
    return typeof freconnum === "string" && freconnum.trim().length > 0;
}
function pickInvoiceNumber(raw, row) {
    return (asNonEmptyString(raw.IVNUM) ??
        asNonEmptyString(row.invoice_number) ??
        asNonEmptyString(raw.FNCIREF1) ??
        asNonEmptyString(raw.PAY_INVOICE_NUMBER) ??
        asNonEmptyString(row.PAY_INVOICE_NUMBER));
}
/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt; queue IVNUM for
 * virtual close instead (IDG_ARFNCITEMS4 only contains closed lines).
 */
function isAccount10149DebitPaymentRow(row) {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 > 0;
}
/**
 * Helam (or similar) cancel AR line: negative DEBIT1, zero CREDIT1.
 * Single-invoice cancels (IVNUM === FNCIREF1) still import as payments.
 * Two-invoice offset stamps (IVNUM ≠ FNCIREF1) are dropped and stamp-closed.
 */
function isAccount10149CancelDebitPaymentRow(row) {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 < 0;
}
/**
 * Helam cancel stamp that offsets a different invoice: IVNUM (cancel doc) ≠
 * FNCIREF1 (original). Both invoices close each other — no payment, no virtual.
 */
function isAccount10149HelamOffsetCancelRow(row) {
    if (!isAccount10149CancelDebitPaymentRow(row)) {
        return false;
    }
    const raw = rawRecordOf(row);
    const merged = { ...row, ...raw };
    if (!isAccount10149ReconciledClose(merged)) {
        return false;
    }
    const cancelInvoice = asNonEmptyString(raw.IVNUM);
    const originalInvoice = asNonEmptyString(raw.FNCIREF1);
    return (cancelInvoice != null &&
        originalInvoice != null &&
        cancelInvoice !== originalInvoice);
}
/** Scan a payment batch for Helam offset cancel stamps (IVNUM ≠ FNCIREF1). */
function collectHelamOffsetPairTargets(payments) {
    const originals = new Set();
    const cancels = new Set();
    for (const row of payments) {
        if (!isAccount10149HelamOffsetCancelRow(row)) {
            continue;
        }
        const raw = rawRecordOf(row);
        const cancelInvoice = asNonEmptyString(raw.IVNUM);
        const originalInvoice = asNonEmptyString(raw.FNCIREF1);
        if (cancelInvoice && originalInvoice) {
            cancels.add(cancelInvoice);
            originals.add(originalInvoice);
        }
    }
    return { originals, cancels };
}
const PAYMENT_AMOUNT_FIELDS = ["amount", "customer_amount"];
function absCancelPaymentAmounts(row) {
    const next = { ...row };
    for (const field of PAYMENT_AMOUNT_FIELDS) {
        const parsed = toFiniteNumber(next[field]);
        if (parsed !== undefined && parsed < 0) {
            next[field] = Math.abs(parsed);
        }
    }
    const raw = rawRecordOf(row);
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1);
    if (toFiniteNumber(next.amount) === undefined &&
        debit1 !== undefined &&
        debit1 < 0) {
        next.amount = Math.abs(debit1);
    }
    if (toFiniteNumber(next.customer_amount) === undefined &&
        debit1 !== undefined &&
        debit1 < 0) {
        next.customer_amount = Math.abs(debit1);
    }
    return next;
}
/**
 * Reconciled IDG_ARFNCITEMS4 line that should settle the linked invoice.
 * Table only returns closed AR lines — FRECONNUM + invoice + BAL=0 is enough
 * (receipt CREDIT1≠0, Helam cancel, or invoice-side debit with no cash).
 */
function isAccount10149ReconciledClose(rawErpRow) {
    const invoiceNumber = asNonEmptyString(rawErpRow.IVNUM) ??
        asNonEmptyString(rawErpRow.FNCIREF1) ??
        asNonEmptyString(rawErpRow.PAY_INVOICE_NUMBER);
    const bal = toFiniteNumber(rawErpRow.BAL) ?? 0;
    return hasFreconnum(rawErpRow) && invoiceNumber != null && bal === 0;
}
/** @deprecated Use {@link isAccount10149ReconciledClose}. */
function isAccount10149ReconciledReceiptClose(rawErpRow) {
    return isAccount10149ReconciledClose(rawErpRow);
}
function rewriteRowCurrencies(row) {
    let changed = false;
    const next = { ...row };
    for (const field of CURRENCY_FIELDS) {
        const current = next[field];
        if (isHebrewShekelCurrencyLabel(current)) {
            next[field] = exports.ILS_CURRENCY_CODE;
            changed = true;
        }
        else if (isDollarCurrencyLabel(current)) {
            next[field] = exports.USD_CURRENCY_CODE;
            changed = true;
        }
    }
    return changed ? next : row;
}
function transformInvoiceRow(row) {
    const withCreditSign = isCreditInvoiceRow(row)
        ? negateCreditInvoiceAmounts(row)
        : row;
    return rewriteRowCurrencies(withCreditSign);
}
function transformPaymentRow(row) {
    if (isAccount10149CancelDebitPaymentRow(row)) {
        return rewriteRowCurrencies(absCancelPaymentAmounts(row));
    }
    if (isAccount10149DebitPaymentRow(row)) {
        return null;
    }
    return rewriteRowCurrencies(row);
}
/**
 * Priority credit-note invoice numbers (e.g. CR26100000032) — recon lines for
 * these are not cash receipts; queue virtual close instead of importing payment.
 */
function isAccount10149CreditInvoiceNumber(invoiceNumber) {
    const trimmed = invoiceNumber?.trim() ?? "";
    return trimmed.length > 0 && /^CR/i.test(trimmed);
}
/**
 * Drop invoice-side positive debits and reconciled credit-note (CR*) lines;
 * queue their IVNUMs for virtual close. Keep normal receipts and single-invoice
 * Helam cancels (IVNUM === FNCIREF1) for payment import + afterPaymentLinked.
 * Helam offset stamps (IVNUM ≠ FNCIREF1) drop both sides and stamp-close both
 * invoices with no virtual payment.
 */
function transformAccount10149Batch(batch, options) {
    const invoices = batch.Invoice;
    const payments = batch.Payment;
    const nextInvoices = invoices && invoices.length > 0
        ? invoices.map(transformInvoiceRow)
        : invoices;
    let nextPayments = payments;
    if (payments && payments.length > 0) {
        const offsetTargets = collectHelamOffsetPairTargets(payments);
        const offsetStampNumbers = new Set([
            ...offsetTargets.originals,
            ...offsetTargets.cancels,
        ]);
        if (offsetStampNumbers.size > 0) {
            options?.onHelamOffsetCloseTargets?.([...offsetStampNumbers]);
        }
        const queuedCloseNumbers = [];
        const queuedCloseDates = new Map();
        const kept = [];
        for (const row of payments) {
            const raw = rawRecordOf(row);
            const reconciled = isAccount10149ReconciledClose({
                ...row,
                ...raw,
            });
            // Two-invoice Helam offset: drop cancel; stamp both (no payment).
            if (reconciled && isAccount10149HelamOffsetCancelRow(row)) {
                continue;
            }
            const ivnum = pickInvoiceNumber(raw, row);
            // Original debit of an offset pair in this batch: drop, no virtual
            // (stamp-close handles both sides).
            if (reconciled &&
                isAccount10149DebitPaymentRow(row) &&
                ivnum != null &&
                offsetTargets.originals.has(ivnum)) {
                continue;
            }
            const dropForVirtualClose = reconciled &&
                (isAccount10149DebitPaymentRow(row) ||
                    isAccount10149CreditInvoiceNumber(ivnum));
            if (dropForVirtualClose) {
                if (ivnum) {
                    queuedCloseNumbers.push(ivnum);
                    const curDate = (0, connectorFieldUtils_1.parseErpDateOnly)(raw.CURDATE ?? row.CURDATE);
                    if (curDate) {
                        queuedCloseDates.set(ivnum.trim(), curDate);
                    }
                }
                continue;
            }
            const transformed = transformPaymentRow(row);
            if (transformed != null) {
                kept.push(transformed);
            }
        }
        if (queuedCloseNumbers.length > 0) {
            options?.onReconciledInvoiceCloseTargets?.(queuedCloseNumbers, queuedCloseDates);
        }
        nextPayments = kept;
    }
    if (nextInvoices === invoices && nextPayments === payments) {
        return batch;
    }
    return {
        ...batch,
        ...(nextInvoices !== invoices ? { Invoice: nextInvoices } : {}),
        ...(nextPayments !== payments ? { Payment: nextPayments } : {}),
    };
}
async function afterAccount10149PaymentLinked(ctx) {
    const closeCandidates = ctx.candidates.filter((candidate) => isAccount10149ReconciledClose(candidate.rawErpRow));
    if (closeCandidates.length === 0) {
        return { invoiceIdsToRecalc: [] };
    }
    const touched = await (0, reconciledVirtualClose_1.applyReconciledVirtualCloses)(ctx.prisma, ctx.accountId, closeCandidates.map((candidate) => ({
        invoiceId: candidate.invoiceId,
        customerId: candidate.customerId,
        invoiceNumber: candidate.invoiceNumber,
        paymentDate: candidate.paymentDate,
    })), ctx.userId);
    return { invoiceIdsToRecalc: [...touched] };
}
exports.account10149Extension = {
    key: exports.ACCOUNT_10149_EXTENSION_KEY,
    label: "Account 10149",
    async transform(ctx) {
        return transformAccount10149Batch(ctx.batch, {
            onReconciledInvoiceCloseTargets: (invoiceNumbers, closeDates) => {
                if (ctx.pendingInvoiceCloses) {
                    for (const invoiceNumber of invoiceNumbers) {
                        ctx.pendingInvoiceCloses.add(invoiceNumber);
                    }
                }
                if (ctx.pendingInvoiceCloseDates && closeDates) {
                    for (const [invoiceNumber, date] of closeDates) {
                        ctx.pendingInvoiceCloseDates.set(invoiceNumber, date);
                    }
                }
            },
            onHelamOffsetCloseTargets: (invoiceNumbers) => {
                if (ctx.pendingHelamOffsetCloses) {
                    for (const invoiceNumber of invoiceNumbers) {
                        ctx.pendingHelamOffsetCloses.add(invoiceNumber);
                    }
                }
            },
        });
    },
    afterPaymentLinked: afterAccount10149PaymentLinked,
    async flushPendingInvoiceCloses(ctx) {
        const closedIds = new Set();
        const customerIds = new Set();
        const offsetNumbers = ctx.helamOffsetInvoiceNumbers ?? [];
        const total = (0, pendingCloseProgress_1.countUniquePendingCloseInvoiceNumbers)(ctx.invoiceNumbers, offsetNumbers);
        const report = (processed) => {
            if (total <= 0) {
                return;
            }
            ctx.onProgress?.({
                processed: Math.min(processed, total),
                total,
            });
        };
        if (total > 0) {
            report(0);
        }
        let processed = 0;
        if (offsetNumbers.length > 0) {
            const helamBaseline = processed;
            const helamQueued = (0, pendingCloseProgress_1.uniqueTrimmedInvoiceNumberSet)(offsetNumbers).size;
            const offsetResult = await (0, helamOffsetClose_1.applyHelamOffsetStampClosesForInvoiceNumbers)(ctx.prisma, ctx.accountId, offsetNumbers, ctx.userId, {
                onProgress: ({ processed: helamProcessed }) => {
                    report(helamBaseline + helamProcessed);
                },
            });
            processed += helamQueued;
            report(processed);
            for (const id of offsetResult.closedIds) {
                closedIds.add(id);
            }
            for (const id of offsetResult.customerIds) {
                customerIds.add(id);
            }
        }
        // Virtual fill only for numbers not already stamp-closed as Helam offset.
        const offsetSet = (0, pendingCloseProgress_1.uniqueTrimmedInvoiceNumberSet)(offsetNumbers);
        const virtualNumbers = ctx.invoiceNumbers.filter((value) => !offsetSet.has(value.trim()));
        if (virtualNumbers.length > 0) {
            const result = await (0, reconciledVirtualClose_1.applyReconciledVirtualClosesForInvoiceNumbers)(ctx.prisma, ctx.accountId, virtualNumbers, ctx.userId, ctx.invoiceCloseDates);
            processed += result.missingNumbers.length;
            report(processed);
            const recalcBaseline = processed;
            const recalcTotal = result.touchedIds.length;
            if (result.touchedIds.length > 0) {
                // Dynamic import avoids account_10149 ↔ extensions ↔ recalc cycle.
                const { recalculateInvoicesFromLinkedPayments } = await Promise.resolve().then(() => __importStar(require("../../invoice/linkDeferredPaymentAndRecalc")));
                await recalculateInvoicesFromLinkedPayments(ctx.prisma, new Map(result.touchedIds.map((invoiceId) => [invoiceId, {}])), {
                    onProgress: ({ processed: recalcProcessed }) => {
                        report(recalcBaseline + recalcProcessed);
                    },
                });
            }
            processed = recalcBaseline + recalcTotal;
            report(processed);
            for (const id of result.touchedIds) {
                closedIds.add(id);
            }
            for (const id of result.customerIds) {
                customerIds.add(id);
            }
        }
        if (total > 0) {
            report(total);
        }
        return {
            closedIds: [...closedIds],
            customerIds: [...customerIds],
        };
    },
    normalizePaymentCurrency: normalizeAccount10149PaymentCurrency,
    alignPaymentAmountsForInvoice: alignAccount10149PaymentAmountsForInvoice,
};
