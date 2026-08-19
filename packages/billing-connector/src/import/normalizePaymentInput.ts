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

function excelSerialDateToISODate(serial: number): string {
    const utcDays = Math.floor(serial - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    return date.toISOString().slice(0, 10);
}

function toOptionalPaymentNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}

export function normalizePaymentInput(
    record: Record<string, unknown>
): InvoicePaymentInput {
    let paymentDateStr = "";

    if (typeof record.payment_date === "number") {
        paymentDateStr = excelSerialDateToISODate(record.payment_date);
    } else if (record.payment_date instanceof Date) {
        paymentDateStr = record.payment_date.toISOString().split("T")[0];
    } else if (typeof record.payment_date === "string") {
        const dateObj = new Date(record.payment_date);
        if (!Number.isNaN(dateObj.getTime())) {
            paymentDateStr = dateObj.toISOString().split("T")[0];
        } else {
            paymentDateStr = record.payment_date;
        }
    }

    return {
        account_id: Number(record.account_id),
        company_code: String(record.company_code ?? "").trim(),
        customer_number: String(record.customer_number),
        invoice_number: String(
            record.invoice_number ??
                record.FNCIREF1 ??
                record.PAY_INVOICE_NUMBER ??
                ""
        ).trim(),
        payment_date: paymentDateStr,
        amount: toOptionalPaymentNumber(record.amount),
        customer_amount: Number(record.customer_amount),
        payment_method: record.payment_method
            ? String(record.payment_method).trim()
            : "",
        customer_currency: String(record.customer_currency).trim(),
        reference: record.reference ? String(record.reference).trim() : "",
        ...(record._rawRecord
            ? { _rawRecord: record._rawRecord as Record<string, unknown> }
            : {}),
    };
}

export function toPaymentInput(
    row: Record<string, unknown>,
    accountId: number
): InvoicePaymentInput {
    const raw = (row._rawRecord as Record<string, unknown> | undefined) ?? row;
    const fnciRaw =
        raw.FNCIREF1 ??
        raw.PAY_INVOICE_NUMBER ??
        row.FNCIREF1 ??
        row.PAY_INVOICE_NUMBER;
    const fnciref1 =
        typeof fnciRaw === "string" && fnciRaw.trim()
            ? fnciRaw.trim()
            : undefined;

    return normalizePaymentInput({
        ...row,
        invoice_number: fnciref1 ?? row.invoice_number,
        account_id: accountId,
        company_code: row.company_code ?? "",
        _rawRecord: raw,
    });
}
