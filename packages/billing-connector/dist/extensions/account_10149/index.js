"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.account10149Extension = exports.USD_CURRENCY_CODE = exports.ILS_CURRENCY_CODE = exports.ACCOUNT_10149_ID = exports.ACCOUNT_10149_EXTENSION_KEY = void 0;
exports.isHebrewShekelCurrencyLabel = isHebrewShekelCurrencyLabel;
exports.isDollarCurrencyLabel = isDollarCurrencyLabel;
exports.normalizeAccount10149PaymentCurrency = normalizeAccount10149PaymentCurrency;
exports.alignAccount10149PaymentAmountsForInvoice = alignAccount10149PaymentAmountsForInvoice;
exports.isAccount10149DebitPaymentRow = isAccount10149DebitPaymentRow;
exports.isAccount10149CancelDebitPaymentRow = isAccount10149CancelDebitPaymentRow;
exports.isAccount10149ReconciledReceiptClose = isAccount10149ReconciledReceiptClose;
exports.shouldNormalizeAccount10149NegativeCreditPayments = shouldNormalizeAccount10149NegativeCreditPayments;
exports.transformAccount10149Batch = transformAccount10149Batch;
exports.afterAccount10149PaymentLinked = afterAccount10149PaymentLinked;
const reconciledVirtualClose_1 = require("./reconciledVirtualClose");
/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon close, Helam cancel payments, credit abs payments. */
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
/**
 * Priority IDG_ARFNCITEMS4 dual currency:
 * CODE + CREDIT1/DEBIT1 (primary) and CODE5 + CREDIT5/DEBIT5 (secondary).
 * Pick the side matching the invoice currency; keep the other as base amount.
 */
function alignAccount10149PaymentAmountsForInvoice(input) {
    const raw = input.rawErpRow;
    const invoiceCurrency = normalizeAccount10149PaymentCurrency(input.invoiceCustomerCurrency);
    if (!invoiceCurrency) {
        return {
            amount: input.amount,
            customer_amount: input.customer_amount,
            customer_currency: input.customer_currency,
        };
    }
    const code = normalizeAccount10149PaymentCurrency(raw.CODE ?? input.customer_currency);
    const code5 = normalizeAccount10149PaymentCurrency(raw.CODE5);
    const amount1 = pickNonZeroAmount(raw.CREDIT1, raw.DEBIT1);
    const amount5 = pickNonZeroAmount(raw.CREDIT5, raw.DEBIT5);
    const invoiceCurrencyRaw = (input.invoiceCustomerCurrency ?? "").trim() ||
        input.customer_currency;
    if (code5 === invoiceCurrency && amount5 !== null) {
        return {
            amount: amount1 ?? input.amount,
            customer_amount: amount5,
            customer_currency: invoiceCurrencyRaw,
        };
    }
    if (code === invoiceCurrency && amount1 !== null) {
        return {
            amount: amount5 ?? input.amount ?? amount1,
            customer_amount: amount1,
            customer_currency: invoiceCurrencyRaw,
        };
    }
    return {
        amount: input.amount,
        customer_amount: input.customer_amount,
        customer_currency: input.customer_currency,
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
function isIdigitalPaymentRow(raw) {
    const fncnum = asNonEmptyString(raw.FNCNUM);
    const fnciref1 = asNonEmptyString(raw.FNCIREF1);
    return (fncnum != null && fnciref1 != null) || hasFreconnum(raw);
}
/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt.
 * Negative DEBIT1 is a Helam cancel line — keep as a closing payment.
 */
function isAccount10149DebitPaymentRow(row) {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 > 0;
}
/**
 * Helam (or similar) cancel AR line: negative DEBIT1, zero CREDIT1.
 * Import as a positive payment against FNCIREF1 so the original invoice can close.
 */
function isAccount10149CancelDebitPaymentRow(row) {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 < 0;
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
 * Reconciled receipt that should close the linked invoice (D2).
 */
function isAccount10149ReconciledReceiptClose(rawErpRow) {
    const fnciref1 = asNonEmptyString(rawErpRow.FNCIREF1) ??
        asNonEmptyString(rawErpRow.PAY_INVOICE_NUMBER);
    const bal = toFiniteNumber(rawErpRow.BAL) ?? 0;
    const credit1 = toFiniteNumber(rawErpRow.CREDIT1) ?? 0;
    return (hasFreconnum(rawErpRow) &&
        fnciref1 != null &&
        bal === 0 &&
        credit1 !== 0);
}
function shouldNormalizeAccount10149NegativeCreditPayments(row) {
    return (isIdigitalPaymentRow(row.rawErpRow) &&
        row.invoiceCustomCode1 === "C" &&
        row.customerAmount < 0);
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
function transformAccount10149Batch(batch) {
    const invoices = batch.Invoice;
    const payments = batch.Payment;
    const nextInvoices = invoices && invoices.length > 0
        ? invoices.map(transformInvoiceRow)
        : invoices;
    let nextPayments = payments;
    if (payments && payments.length > 0) {
        const kept = [];
        for (const row of payments) {
            const transformed = transformPaymentRow(row);
            if (transformed != null) {
                kept.push(transformed);
            }
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
    const reconciled = ctx.candidates.filter((candidate) => isAccount10149ReconciledReceiptClose(candidate.rawErpRow));
    if (reconciled.length === 0) {
        return { invoiceIdsToRecalc: [] };
    }
    const touched = await (0, reconciledVirtualClose_1.applyReconciledVirtualCloses)(ctx.prisma, ctx.accountId, reconciled.map((candidate) => ({
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
    transform(ctx) {
        return transformAccount10149Batch(ctx.batch);
    },
    afterPaymentLinked: afterAccount10149PaymentLinked,
    shouldNormalizeNegativeCreditPayments: shouldNormalizeAccount10149NegativeCreditPayments,
    normalizePaymentCurrency: normalizeAccount10149PaymentCurrency,
    alignPaymentAmountsForInvoice: alignAccount10149PaymentAmountsForInvoice,
};
