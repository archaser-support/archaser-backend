export interface InvoicePaymentInput {
    account_id: number;
    company_code?: string;
    customer_number: string;
    invoice_number: string;
    payment_date: string;
    amount?: number;
    customer_amount: number;
    payment_method?: string;
    customer_currency: string;
    reference: string;
    _rawRecord?: Record<string, unknown>;
}
/** Avoid String(null) → "null"; fall back to Priority CUSTNAME on the ERP row. */
export declare function resolvePaymentCustomerNumber(record: Record<string, unknown>, rawErpRow?: Record<string, unknown>): string;
export declare function normalizePaymentInput(record: Record<string, unknown>): InvoicePaymentInput;
export declare function toPaymentInput(row: Record<string, unknown>, accountId: number): InvoicePaymentInput;
