"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePaymentCustomerNumber = resolvePaymentCustomerNumber;
exports.normalizePaymentInput = normalizePaymentInput;
exports.toPaymentInput = toPaymentInput;
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
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
function asTrimmedString(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value).trim();
    }
    if (typeof value !== "string") {
        return "";
    }
    return value.trim();
}
/** Avoid String(null) → "null"; fall back to Priority CUSTNAME on the ERP row. */
function resolvePaymentCustomerNumber(record, rawErpRow) {
    const raw = rawErpRow ?? record._rawRecord;
    const direct = asTrimmedString(record.customer_number);
    if (direct) {
        return direct;
    }
    if (raw) {
        const fromErp = asTrimmedString(raw.CUSTNAME) ||
            asTrimmedString(raw.IDG_CUSTNAME);
        if (fromErp) {
            return fromErp;
        }
    }
    return "";
}
function normalizePaymentInput(record) {
    let paymentDateStr = "";
    if (typeof record.payment_date === "number") {
        paymentDateStr = excelSerialDateToISODate(record.payment_date);
    }
    else {
        paymentDateStr = (0, connectorFieldUtils_1.toErpDateOnly)(record.payment_date);
    }
    const raw = record._rawRecord;
    return {
        account_id: Number(record.account_id),
        company_code: String(record.company_code ?? "").trim(),
        customer_number: resolvePaymentCustomerNumber(record, raw),
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
