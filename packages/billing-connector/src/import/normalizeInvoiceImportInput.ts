import { toErpDateOnly } from "../utils/connectorFieldUtils";

export interface NormalizedInvoiceInput {
    account_id: number;
    customer_number: string;
    invoice_number: string;
    invoice_date: string;
    due_date?: string;
    amount: number;
    customer_amount?: number;
    amount_without_vat?: number;
    vat_amount?: number;
    customer_amount_without_vat?: number;
    customer_vat_amount?: number;
    customer_currency?: string;
    total_paid?: number;
    customer_total_paid?: number;
    status?: string;
    credit_for_invoice_number?: string;
    actual_reporting_date?: string | Date;
    custom_code1?: string;
}

function toOptionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const parsed =
        typeof value === "string" ? parseFloat(value) : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Priority (and similar) often map document-currency DISPRICE/VAT into the
 * base-currency without-VAT / VAT fields. When base `amount` and document
 * `customer_amount` differ (FX), promote those values to the customer-*
 * fields and scale into account currency via the invoice FX ratio.
 */
export function alignInvoiceVatFieldsToCurrencies(input: {
    amount: number;
    customerAmount?: number;
    amountWithoutVat?: number;
    vatAmount?: number;
    customerAmountWithoutVat?: number;
    customerVatAmount?: number;
}): {
    amountWithoutVat?: number;
    vatAmount?: number;
    customerAmountWithoutVat?: number;
    customerVatAmount?: number;
} {
    const amount = Number(input.amount);
    const customerAmount =
        input.customerAmount == null ? undefined : Number(input.customerAmount);
    let amountWithoutVat = input.amountWithoutVat;
    let vatAmount = input.vatAmount;
    let customerAmountWithoutVat = input.customerAmountWithoutVat;
    let customerVatAmount = input.customerVatAmount;

    const isFx =
        customerAmount != null &&
        Number.isFinite(customerAmount) &&
        customerAmount !== 0 &&
        Number.isFinite(amount) &&
        amount !== 0 &&
        Math.abs(amount) !== Math.abs(customerAmount);

    if (isFx && customerAmount != null) {
        // Mis-mapped: document-currency DISPRICE/VAT landed on base fields.
        if (
            customerAmountWithoutVat === undefined &&
            amountWithoutVat !== undefined
        ) {
            customerAmountWithoutVat = amountWithoutVat;
            amountWithoutVat =
                amount * (customerAmountWithoutVat / customerAmount);
        } else if (
            amountWithoutVat === undefined &&
            customerAmountWithoutVat !== undefined
        ) {
            amountWithoutVat =
                amount * (customerAmountWithoutVat / customerAmount);
        }

        if (customerVatAmount === undefined && vatAmount !== undefined) {
            customerVatAmount = vatAmount;
            vatAmount = amount * (customerVatAmount / customerAmount);
        } else if (
            vatAmount === undefined &&
            customerVatAmount !== undefined
        ) {
            vatAmount = amount * (customerVatAmount / customerAmount);
        }
    } else {
        // Same currency: mirror whichever side is present onto the other.
        if (
            amountWithoutVat === undefined &&
            customerAmountWithoutVat !== undefined
        ) {
            amountWithoutVat = customerAmountWithoutVat;
        } else if (
            customerAmountWithoutVat === undefined &&
            amountWithoutVat !== undefined
        ) {
            customerAmountWithoutVat = amountWithoutVat;
        }
        if (vatAmount === undefined && customerVatAmount !== undefined) {
            vatAmount = customerVatAmount;
        } else if (
            customerVatAmount === undefined &&
            vatAmount !== undefined
        ) {
            customerVatAmount = vatAmount;
        }
    }

    return {
        ...(amountWithoutVat !== undefined
            ? { amountWithoutVat }
            : {}),
        ...(vatAmount !== undefined ? { vatAmount } : {}),
        ...(customerAmountWithoutVat !== undefined
            ? { customerAmountWithoutVat }
            : {}),
        ...(customerVatAmount !== undefined
            ? { customerVatAmount }
            : {}),
    };
}

function toOptionalString(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed ? trimmed : undefined;
}

function toCustomCode1(value: unknown): string | undefined {
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
export function normalizeInvoiceImportInput(
    row: Record<string, unknown>,
    accountId: number
): NormalizedInvoiceInput {
    const raw = (row._rawRecord as Record<string, unknown> | undefined) ?? row;
    const mappedCustomCode1 =
        toCustomCode1(row.custom_code1) ?? toCustomCode1(raw.custom_code1);
    const debitFlag = (
        toOptionalString(row.DEBIT) ??
        toOptionalString(raw.DEBIT) ??
        toOptionalString(row.debit) ??
        toOptionalString(raw.debit)
    )?.toUpperCase();
    const customCode1 =
        mappedCustomCode1 ??
        (debitFlag === "C" || debitFlag === "D" ? debitFlag : undefined);

    const amount =
        toOptionalNumber(row.amount) ?? toOptionalNumber(row.base_amount) ?? 0;
    const customerAmount =
        toOptionalNumber(row.customer_amount) ??
        toOptionalNumber(row.invoice_amount);

    const alignedVat = alignInvoiceVatFieldsToCurrencies({
        amount,
        customerAmount,
        amountWithoutVat: toOptionalNumber(row.amount_without_vat),
        vatAmount: toOptionalNumber(row.vat_amount),
        customerAmountWithoutVat: toOptionalNumber(
            row.customer_amount_without_vat
        ),
        customerVatAmount: toOptionalNumber(row.customer_vat_amount),
    });

    const customerCurrency =
        toOptionalString(row.customer_currency) ??
        toOptionalString(row.currency);

    const normalized: NormalizedInvoiceInput = {
        account_id: accountId,
        customer_number: String(row.customer_number ?? ""),
        invoice_number: String(row.invoice_number ?? ""),
        // ERP sends DateTimeOffset; persist calendar date only (no TZ day-shift).
        invoice_date: toErpDateOnly(row.invoice_date),
        amount,
        customer_amount: customerAmount,
        customer_currency: customerCurrency,
        ...(customCode1 ? { custom_code1: customCode1 } : {}),
        ...(alignedVat.amountWithoutVat !== undefined
            ? { amount_without_vat: alignedVat.amountWithoutVat }
            : {}),
        ...(alignedVat.vatAmount !== undefined
            ? { vat_amount: alignedVat.vatAmount }
            : {}),
        ...(alignedVat.customerAmountWithoutVat !== undefined
            ? {
                  customer_amount_without_vat:
                      alignedVat.customerAmountWithoutVat,
              }
            : {}),
        ...(alignedVat.customerVatAmount !== undefined
            ? { customer_vat_amount: alignedVat.customerVatAmount }
            : {}),
    };

    const dueDate = toErpDateOnly(row.due_date);
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
