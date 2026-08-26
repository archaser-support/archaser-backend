export interface NormalizedInvoiceInput {
    account_id: number;
    customer_number: string;
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    amount: number;
    customer_amount?: number;
    customer_currency?: string;
    total_paid?: number;
    customer_total_paid?: number;
    status?: string;
    credit_for_invoice_number?: string;
    actual_reporting_date?: string | Date;
    custom_code1?: string;
}
/**
 * Normalize invoice import rows from file catalog or billing connector field names.
 */
export declare function normalizeInvoiceImportInput(row: Record<string, unknown>, accountId: number): NormalizedInvoiceInput;
