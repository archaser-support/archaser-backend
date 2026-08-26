"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.account10149Extension = exports.ILS_CURRENCY_CODE = exports.ACCOUNT_10149_ID = exports.ACCOUNT_10149_EXTENSION_KEY = void 0;
exports.isHebrewShekelCurrencyLabel = isHebrewShekelCurrencyLabel;
exports.normalizeAccount10149PaymentCurrency = normalizeAccount10149PaymentCurrency;
exports.transformAccount10149Batch = transformAccount10149Batch;
/** Account 10149 billing extension — credit amount sign and shekel currency alias. */
exports.ACCOUNT_10149_EXTENSION_KEY = "account_10149";
exports.ACCOUNT_10149_ID = 10149;
exports.ILS_CURRENCY_CODE = "ILS";
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
function normalizeAccount10149PaymentCurrency(currency) {
    if (currency == null) {
        return "";
    }
    if (isHebrewShekelCurrencyLabel(currency)) {
        return exports.ILS_CURRENCY_CODE;
    }
    return currency.trim().toUpperCase();
}
function rewriteRowCurrencies(row) {
    let changed = false;
    const next = { ...row };
    for (const field of CURRENCY_FIELDS) {
        if (isHebrewShekelCurrencyLabel(next[field])) {
            next[field] = exports.ILS_CURRENCY_CODE;
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
function transformAccount10149Batch(batch) {
    const invoices = batch.Invoice;
    const payments = batch.Payment;
    const nextInvoices = invoices && invoices.length > 0
        ? invoices.map(transformInvoiceRow)
        : invoices;
    const nextPayments = payments && payments.length > 0
        ? payments.map(rewriteRowCurrencies)
        : payments;
    if (nextInvoices === invoices && nextPayments === payments) {
        return batch;
    }
    return {
        ...batch,
        ...(nextInvoices !== invoices ? { Invoice: nextInvoices } : {}),
        ...(nextPayments !== payments ? { Payment: nextPayments } : {}),
    };
}
exports.account10149Extension = {
    key: exports.ACCOUNT_10149_EXTENSION_KEY,
    label: "Account 10149",
    transform(ctx) {
        return transformAccount10149Batch(ctx.batch);
    },
};
