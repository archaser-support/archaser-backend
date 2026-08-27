"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortInvoicesForImport = sortInvoicesForImport;
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
function normalizeInvoiceDate(date) {
    return (0, connectorFieldUtils_1.toErpDateOnly)(date);
}
/**
 * Sort invoices for import: invoice_date ascending, then invoice_number ascending,
 * grouped per customer_number in stable customer order.
 */
function sortInvoicesForImport(invoices) {
    const byCustomer = new Map();
    for (const invoice of invoices) {
        const key = invoice.customer_number;
        const group = byCustomer.get(key);
        if (group) {
            group.push(invoice);
        }
        else {
            byCustomer.set(key, [invoice]);
        }
    }
    const sortedCustomerNumbers = Array.from(byCustomer.keys()).sort();
    const result = [];
    for (const customerNumber of sortedCustomerNumbers) {
        const group = byCustomer.get(customerNumber);
        group.sort((a, b) => {
            const dateCompare = normalizeInvoiceDate(a.invoice_date).localeCompare(normalizeInvoiceDate(b.invoice_date));
            if (dateCompare !== 0) {
                return dateCompare;
            }
            return a.invoice_number.localeCompare(b.invoice_number);
        });
        result.push(...group);
    }
    return result;
}
