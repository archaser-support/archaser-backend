export interface SortableInvoiceRow {
    customer_number: string;
    invoice_number: string;
    invoice_date: string;
}

function normalizeInvoiceDate(date: string): string {
    if (!date) {
        return "";
    }
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return String(date);
    }
    return parsed.toISOString().slice(0, 10);
}

/**
 * Sort invoices for import: invoice_date ascending, then invoice_number ascending,
 * grouped per customer_number in stable customer order.
 */
export function sortInvoicesForImport<T extends SortableInvoiceRow>(
    invoices: T[]
): T[] {
    const byCustomer = new Map<string, T[]>();

    for (const invoice of invoices) {
        const key = invoice.customer_number;
        const group = byCustomer.get(key);
        if (group) {
            group.push(invoice);
        } else {
            byCustomer.set(key, [invoice]);
        }
    }

    const sortedCustomerNumbers = Array.from(byCustomer.keys()).sort();
    const result: T[] = [];

    for (const customerNumber of sortedCustomerNumbers) {
        const group = byCustomer.get(customerNumber)!;
        group.sort((a, b) => {
            const dateCompare = normalizeInvoiceDate(
                a.invoice_date
            ).localeCompare(normalizeInvoiceDate(b.invoice_date));
            if (dateCompare !== 0) {
                return dateCompare;
            }
            return a.invoice_number.localeCompare(b.invoice_number);
        });
        result.push(...group);
    }

    return result;
}
