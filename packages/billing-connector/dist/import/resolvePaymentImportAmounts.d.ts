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
export type PaymentImportResolutionResult = {
    ok: true;
    amount: number;
    customer_amount: number;
    customer_currency: string;
} | {
    ok: false;
    errorKey: string;
};
export type PaymentImportResolutionOptions = {
    /** Canonicalize codes before comparing payment vs invoice currency. */
    normalizeCurrency?: (currency: string | null | undefined) => string;
};
/**
 * Resolve base and customer payment amounts for import.
 * When base `amount` is omitted, derives it from the linked invoice's embedded FX ratio.
 */
export declare function resolvePaymentImportAmounts(row: PaymentImportResolutionInput, invoice: InvoiceAmountContext, options?: PaymentImportResolutionOptions): PaymentImportResolutionResult;
