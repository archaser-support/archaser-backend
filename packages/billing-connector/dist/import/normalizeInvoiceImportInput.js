"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeInvoiceImportInput = normalizeInvoiceImportInput;
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
/**
 * Normalize invoice import rows from file catalog or billing connector field names.
 */
function normalizeInvoiceImportInput(row, accountId) {
    const raw = row._rawRecord ?? row;
    const rawDebit = row.DEBIT ??
        raw.DEBIT ??
        row.debit ??
        raw.debit ??
        row.priority_erp_debit ??
        raw.priority_erp_debit;
    const debitFlag = typeof rawDebit === "string" ? rawDebit.trim().toUpperCase() : undefined;
    const priorityErpDebit = debitFlag === "C" || debitFlag === "D" ? debitFlag : undefined;
    const amount = toOptionalNumber(row.amount) ?? toOptionalNumber(row.base_amount) ?? 0;
    const customerAmount = toOptionalNumber(row.customer_amount) ??
        toOptionalNumber(row.invoice_amount);
    const customerCurrency = toOptionalString(row.customer_currency) ??
        toOptionalString(row.currency);
    const normalized = {
        account_id: accountId,
        customer_number: String(row.customer_number ?? ""),
        invoice_number: String(row.invoice_number ?? ""),
        invoice_date: String(row.invoice_date ?? ""),
        amount,
        customer_amount: customerAmount,
        customer_currency: customerCurrency,
        ...(priorityErpDebit ? { priority_erp_debit: priorityErpDebit } : {}),
    };
    const dueDate = toOptionalString(row.due_date);
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
