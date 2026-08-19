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
    priority_erp_debit?: string;
}

function toOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const parsed =
        typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function toOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
}

/**
 * Normalize invoice import rows from file catalog or billing connector field names.
 */
export function normalizeInvoiceImportInput(
    row: Record<string, unknown>,
    accountId: number
): NormalizedInvoiceInput {
    const raw = (row._rawRecord as Record<string, unknown> | undefined) ?? row;
    const rawDebit =
        row.DEBIT ??
        raw.DEBIT ??
        row.debit ??
        raw.debit ??
        row.priority_erp_debit ??
        raw.priority_erp_debit;
    const debitFlag =
        typeof rawDebit === "string" ? rawDebit.trim().toUpperCase() : undefined;
    const priorityErpDebit =
        debitFlag === "C" || debitFlag === "D" ? debitFlag : undefined;

    const amount =
        toOptionalNumber(row.amount) ?? toOptionalNumber(row.base_amount) ?? 0;
    const customerAmount =
        toOptionalNumber(row.customer_amount) ??
        toOptionalNumber(row.invoice_amount);

    const customerCurrency =
        toOptionalString(row.customer_currency) ??
        toOptionalString(row.currency);

    const normalized: NormalizedInvoiceInput = {
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
        ? (rawSubformObj[0] as Record<string, unknown> | undefined)
        : typeof rawSubformObj === "object" && rawSubformObj !== null
          ? (rawSubformObj as Record<string, unknown>)
          : undefined;

    const creditFor =
        toOptionalString(row.credit_for_invoice_number) ??
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
        normalized.actual_reporting_date = row.actual_reporting_date as
            | string
            | Date;
    }

    return normalized;
}
