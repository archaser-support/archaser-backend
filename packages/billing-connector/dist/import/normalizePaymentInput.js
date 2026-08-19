"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePaymentInput = normalizePaymentInput;
exports.toPaymentInput = toPaymentInput;
function excelSerialDateToISODate(serial) {
    const utcDays = Math.floor(serial - 25569);
    const date = new Date(utcDays * 86400 * 1000);
    return date.toISOString().slice(0, 10);
}
function toOptionalPaymentNumber(value) {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}
function normalizePaymentInput(record) {
    let paymentDateStr = "";
    if (typeof record.payment_date === "number") {
        paymentDateStr = excelSerialDateToISODate(record.payment_date);
    }
    else if (record.payment_date instanceof Date) {
        paymentDateStr = record.payment_date.toISOString().split("T")[0];
    }
    else if (typeof record.payment_date === "string") {
        const dateObj = new Date(record.payment_date);
        if (!Number.isNaN(dateObj.getTime())) {
            paymentDateStr = dateObj.toISOString().split("T")[0];
        }
        else {
            paymentDateStr = record.payment_date;
        }
    }
    return {
        account_id: Number(record.account_id),
        company_code: String(record.company_code ?? "").trim(),
        customer_number: String(record.customer_number),
        invoice_number: String(record.invoice_number ??
            record.FNCIREF1 ??
            record.PAY_INVOICE_NUMBER ??
            "").trim(),
        payment_date: paymentDateStr,
        amount: toOptionalPaymentNumber(record.amount),
        customer_amount: Number(record.customer_amount),
        payment_method: record.payment_method
            ? String(record.payment_method).trim()
            : "",
        customer_currency: String(record.customer_currency).trim(),
        reference: record.reference ? String(record.reference).trim() : "",
        ...(record._rawRecord
            ? { _rawRecord: record._rawRecord }
            : {}),
    };
}
function toPaymentInput(row, accountId) {
    const raw = row._rawRecord ?? row;
    const fnciRaw = raw.FNCIREF1 ??
        raw.PAY_INVOICE_NUMBER ??
        row.FNCIREF1 ??
        row.PAY_INVOICE_NUMBER;
    const fnciref1 = typeof fnciRaw === "string" && fnciRaw.trim()
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
