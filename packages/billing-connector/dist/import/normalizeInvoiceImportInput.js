"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeInvoiceImportInput = normalizeInvoiceImportInput;
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
function toOptionalNumber(value) {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const parsed = typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function toOptionalString(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
}
function toCustomCode1(value) {
    const trimmed = toOptionalString(value);
    if (!trimmed) {
        return undefined;
    }
    const upper = trimmed.toUpperCase();
    return upper === "C" || upper === "D" ? upper : trimmed;
}
/**
 * Normalize invoice import rows from file catalog or billing connector field names.
 */
function normalizeInvoiceImportInput(row, accountId) {
    const raw = row._rawRecord ?? row;
    const mappedCustomCode1 = toCustomCode1(row.custom_code1) ?? toCustomCode1(raw.custom_code1);
    const debitFlag = (toOptionalString(row.DEBIT) ??
        toOptionalString(raw.DEBIT) ??
        toOptionalString(row.debit) ??
        toOptionalString(raw.debit))?.toUpperCase();
    const customCode1 = mappedCustomCode1 ??
        (debitFlag === "C" || debitFlag === "D" ? debitFlag : undefined);
    const amount = toOptionalNumber(row.amount) ?? toOptionalNumber(row.base_amount) ?? 0;
    const customerAmount = toOptionalNumber(row.customer_amount) ??
        toOptionalNumber(row.invoice_amount);
    const customerCurrency = toOptionalString(row.customer_currency) ??
        toOptionalString(row.currency);
    const normalized = {
        account_id: accountId,
        customer_number: String(row.customer_number ?? ""),
        invoice_number: String(row.invoice_number ?? ""),
        // ERP sends DateTimeOffset; persist calendar date only (no TZ day-shift).
        invoice_date: (0, connectorFieldUtils_1.toErpDateOnly)(row.invoice_date),
        amount,
        customer_amount: customerAmount,
        customer_currency: customerCurrency,
        ...(customCode1 ? { custom_code1: customCode1 } : {}),
    };
    const dueDate = (0, connectorFieldUtils_1.toErpDateOnly)(row.due_date);
    if (dueDate) {
        normalized.due_date = dueDate;
    }
    const totalPaid = toOptionalNumber(row.total_paid);
    if (totalPaid !== undefined) {
        normalized.total_paid = totalPaid;
    }
    const customerTotalPaid = toOptionalNumber(row.customer_total_paid);
    if (customerTotalPaid !== undefined) {
        normalized.customer_total_paid = customerTotalPaid;
    }
    const status = toOptionalString(row.status);
    if (status) {
        normalized.status = status;
    }
    const rawSubformObj = raw.CINVOICESCONT_SUBFORM ?? row.CINVOICESCONT_SUBFORM;
    const creditForSubform = Array.isArray(rawSubformObj)
        ? rawSubformObj[0]
        : typeof rawSubformObj === "object" && rawSubformObj !== null
            ? rawSubformObj
            : undefined;
    const creditFor = toOptionalString(row.credit_for_invoice_number) ??
        toOptionalString(raw.credit_for_invoice_number) ??
        toOptionalString(row.PIVNUM) ??
        toOptionalString(raw.PIVNUM) ??
        toOptionalString(row.CREDITFOR) ??
        toOptionalString(raw.CREDITFOR) ??
        toOptionalString(row["CINVOICESCONT_SUBFORM.PIVNUM"]) ??
        toOptionalString(raw["CINVOICESCONT_SUBFORM.PIVNUM"]) ??
        toOptionalString(creditForSubform?.PIVNUM);
    if (creditFor) {
        normalized.credit_for_invoice_number = creditFor;
    }
    if (row.actual_reporting_date != null && row.actual_reporting_date !== "") {
        normalized.actual_reporting_date = row.actual_reporting_date;
    }
    return normalized;
}
