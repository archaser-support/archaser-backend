export interface SortableInvoiceRow {
    customer_number: string;
    invoice_number: string;
    invoice_date: string;
}
/**
 * Sort invoices for import: invoice_date ascending, then invoice_number ascending,
 * grouped per customer_number in stable customer order.
 */
export declare function sortInvoicesForImport<T extends SortableInvoiceRow>(invoices: T[]): T[];
