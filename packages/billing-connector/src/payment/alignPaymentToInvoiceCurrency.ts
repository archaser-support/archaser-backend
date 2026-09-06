/**
 * Convert a payment recorded in the invoice's *base* currency into the
 * invoice's customer currency, using the FX ratio embedded in the invoice.
 *
 * Priority books dual currency on the invoice/debit line only; receipt lines
 * carry the base (company) currency alone. Such receipts therefore arrive
 * labelled e.g. ILS against a USD invoice, and the ratio on the invoice
 * (base amount / customer amount) is the only conversion factor available.
 */

export type InvoiceFxContext = {
    amount: number | null | undefined;
    customer_amount: number | null | undefined;
    customer_currency: string | null | undefined;
};

export type StoredPaymentAmounts = {
    amount: number | null | undefined;
    customer_amount: number | null | undefined;
    customer_currency: string | null | undefined;
};

export type PaymentCurrencyAlignment = {
    amount: number;
    customer_amount: number;
    customer_currency: string;
};

export type AlignPaymentToInvoiceCurrencyOptions = {
    /** Canonicalize codes before comparing (e.g. Hebrew shekel label -> ILS). */
    normalizeCurrency?: (currency: string | null | undefined) => string;
};

function defaultNormalizeCurrency(currency: string | null | undefined): string {
    return (currency ?? "").trim().toUpperCase();
}

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Base-per-customer FX ratio embedded in an invoice (Priority IDG_SUM1/IDG_SUM2).
 * Null when unusable, or exactly 1 — a same-currency invoice carries no FX
 * information, so converting with it would only mislabel the currency.
 */
export function deriveInvoiceFxRatio(
    invoiceAmount: number | null | undefined,
    invoiceCustomerAmount: number | null | undefined
): number | null {
    if (
        invoiceAmount == null ||
        invoiceCustomerAmount == null ||
        !Number.isFinite(invoiceAmount) ||
        !Number.isFinite(invoiceCustomerAmount) ||
        invoiceCustomerAmount === 0
    ) {
        return null;
    }
    const ratio = invoiceAmount / invoiceCustomerAmount;
    if (!Number.isFinite(ratio) || ratio === 0 || ratio === 1) {
        return null;
    }
    return ratio;
}

/**
 * Returns corrected amounts, or null when the payment needs no change
 * (currencies already agree, or no usable ratio to convert with).
 *
 * `payment.amount` is treated as the base-currency figure: the deferred import
 * path stores the ERP base amount in both `amount` and `customer_amount`.
 */
export function alignPaymentToInvoiceCurrency(
    payment: StoredPaymentAmounts,
    invoice: InvoiceFxContext,
    options?: AlignPaymentToInvoiceCurrencyOptions
): PaymentCurrencyAlignment | null {
    const normalize = options?.normalizeCurrency ?? defaultNormalizeCurrency;
    const invoiceCurrency = normalize(invoice.customer_currency);
    const paymentCurrency = normalize(payment.customer_currency);

    if (!invoiceCurrency || !paymentCurrency) {
        return null;
    }
    if (paymentCurrency === invoiceCurrency) {
        return null;
    }

    const baseAmount = payment.amount;
    if (baseAmount == null || !Number.isFinite(baseAmount)) {
        return null;
    }

    const ratio = deriveInvoiceFxRatio(invoice.amount, invoice.customer_amount);
    if (ratio === null) {
        return null;
    }

    return {
        amount: baseAmount,
        customer_amount: roundCurrency(baseAmount / ratio),
        customer_currency:
            (invoice.customer_currency ?? "").trim() || invoiceCurrency,
    };
}
