export type PaymentImportResolutionInput = {
    amount?: number;
    customer_amount: number;
    customer_currency: string;
};

export type InvoiceAmountContext = {
    amount: number | null;
    customer_amount: number | null;
    customer_currency: string | null;
};

export type PaymentImportResolutionResult =
    | {
          ok: true;
          amount: number;
          customer_amount: number;
          customer_currency: string;
      }
    | { ok: false; errorKey: string };

function normalizeCurrencyCode(currency: string | null | undefined): string {
    return (currency ?? "").trim().toUpperCase();
}

function isInvalidInvoiceRatio(
    invoiceAmount: number | null,
    invoiceCustomerAmount: number | null
): boolean {
    return (
        invoiceAmount === null ||
        invoiceCustomerAmount === null ||
        invoiceAmount === 0 ||
        invoiceCustomerAmount === 0
    );
}

/**
 * Resolve base and customer payment amounts for import.
 * When base `amount` is omitted, derives it from the linked invoice's embedded FX ratio.
 */
export function resolvePaymentImportAmounts(
    row: PaymentImportResolutionInput,
    invoice: InvoiceAmountContext
): PaymentImportResolutionResult {
    const customer_amount = row.customer_amount;
    const customer_currency = row.customer_currency.trim();

    if (customer_amount === 0) {
        return {
            ok: false,
            errorKey: "import.validation.paymentCustomerAmountZero",
        };
    }

    const rowCurrency = normalizeCurrencyCode(customer_currency);
    const invoiceCurrency = normalizeCurrencyCode(invoice.customer_currency);

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

    const ratio = invoice.amount! / invoice.customer_amount!;
    const amount = customer_amount * ratio;

    return {
        ok: true,
        amount,
        customer_amount,
        customer_currency,
    };
}
