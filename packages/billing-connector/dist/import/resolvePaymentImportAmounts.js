"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePaymentImportAmounts = resolvePaymentImportAmounts;
function normalizeCurrencyCode(currency) {
    return (currency ?? "").trim().toUpperCase();
}
function isInvalidInvoiceRatio(invoiceAmount, invoiceCustomerAmount) {
    return (invoiceAmount === null ||
        invoiceCustomerAmount === null ||
        invoiceAmount === 0 ||
        invoiceCustomerAmount === 0);
}
/**
 * Resolve base and customer payment amounts for import.
 * When base `amount` is omitted, derives it from the linked invoice's embedded FX ratio.
 */
function resolvePaymentImportAmounts(row, invoice, options) {
    const customer_amount = row.customer_amount;
    const customer_currency = row.customer_currency.trim();
    if (customer_amount === 0) {
        return {
            ok: false,
            errorKey: "import.validation.paymentCustomerAmountZero",
        };
    }
    const normalize = options?.normalizeCurrency ?? normalizeCurrencyCode;
    const rowCurrency = normalize(customer_currency);
    const invoiceCurrency = normalize(invoice.customer_currency);
    if (invoiceCurrency && rowCurrency !== invoiceCurrency) {
        return {
            ok: false,
            errorKey: "import.validation.paymentCurrencyMismatch",
        };
    }
    if (row.amount !== undefined && Number.isFinite(row.amount)) {
        return {
            ok: true,
            amount: row.amount,
            customer_amount,
            customer_currency,
        };
    }
    if (isInvalidInvoiceRatio(invoice.amount, invoice.customer_amount)) {
        return {
            ok: false,
            errorKey: "import.validation.paymentInvoiceRatioUnavailable",
        };
    }
    const ratio = invoice.amount / invoice.customer_amount;
    const amount = customer_amount * ratio;
    return {
        ok: true,
        amount,
        customer_amount,
        customer_currency,
    };
}
