import type {
    BillingAccountExtension,
    ExtensionCreditPaymentCloseInput,
    ExtensionLinkedPayment,
    ExtensionMappedBatch,
    ExtensionTransformContext,
} from "../types";

/** Account 10149 billing extension — credit sign, shekel→ILS, Helam close, credit abs payments. */
export const ACCOUNT_10149_EXTENSION_KEY = "account_10149";
export const ACCOUNT_10149_ID = 10149;
export const ILS_CURRENCY_CODE = "ILS";
/** Exact FNCPATNAME close code stored on InvoicePayment.payment_method. */
export const IDIGITAL_HELAM_PAYMENT_METHOD = "חלמ";

const INVOICE_AMOUNT_FIELDS = [
    "amount",
    "customer_amount",
    "base_amount",
    "invoice_amount",
] as const;

const CURRENCY_FIELDS = ["currency", "customer_currency"] as const;

/** Quote marks seen in Hebrew shekel abbreviations (ASCII, typographic, geresh). */
const SHEKEL_QUOTE_CHARS = /['"‘’“”׳״`]/g;

function rawRecordOf(row: Record<string, unknown>): Record<string, unknown> {
    const raw = row._rawRecord;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        return raw as Record<string, unknown>;
    }
    return {};
}

function isCreditInvoiceRow(row: Record<string, unknown>): boolean {
    const raw = rawRecordOf(row);
    const debit =
        row.custom_code1 ??
        row.DEBIT ??
        row.debit ??
        raw.custom_code1 ??
        raw.DEBIT ??
        raw.debit;
    return typeof debit === "string" && debit.trim().toUpperCase() === "C";
}

function toFiniteNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === "") {
        return undefined;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function negateCreditInvoiceAmounts(
    row: Record<string, unknown>
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...row };
    for (const field of INVOICE_AMOUNT_FIELDS) {
        const parsed = toFiniteNumber(next[field]);
        if (parsed !== undefined) {
            next[field] = parsed * -1;
        }
    }
    return next;
}

function shekelLettersOf(value: string): string {
    return value.trim().replace(/\s+/g, "").replace(SHEKEL_QUOTE_CHARS, "");
}

export function isHebrewShekelCurrencyLabel(value: unknown): boolean {
    return typeof value === "string" && shekelLettersOf(value) === "שח";
}

export function normalizeAccount10149PaymentCurrency(
    currency: string | null | undefined
): string {
    if (currency == null) {
        return "";
    }
    if (isHebrewShekelCurrencyLabel(currency)) {
        return ILS_CURRENCY_CODE;
    }
    return currency.trim().toUpperCase();
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function isIdigitalPaymentRow(raw: Record<string, unknown>): boolean {
    const fncnum = asNonEmptyString(raw.FNCNUM);
    const fnciref1 = asNonEmptyString(raw.FNCIREF1);
    const freconnum = raw.FRECONNUM;
    const hasFreconnum =
        (typeof freconnum === "string" && freconnum.trim().length > 0) ||
        typeof freconnum === "number";
    return (fncnum != null && fnciref1 != null) || hasFreconnum;
}

export function isAccount10149ForcePaidClose(
    payment: ExtensionLinkedPayment
): boolean {
    return (
        (payment.payment_method ?? "").trim() === IDIGITAL_HELAM_PAYMENT_METHOD
    );
}

export function shouldNormalizeAccount10149NegativeCreditPayments(
    row: ExtensionCreditPaymentCloseInput
): boolean {
    return (
        isIdigitalPaymentRow(row.rawErpRow) &&
        row.invoiceCustomCode1 === "C" &&
        row.customerAmount < 0
    );
}

function rewriteRowCurrencies(
    row: Record<string, unknown>
): Record<string, unknown> {
    let changed = false;
    const next: Record<string, unknown> = { ...row };
    for (const field of CURRENCY_FIELDS) {
        if (isHebrewShekelCurrencyLabel(next[field])) {
            next[field] = ILS_CURRENCY_CODE;
            changed = true;
        }
    }
    return changed ? next : row;
}

function transformInvoiceRow(
    row: Record<string, unknown>
): Record<string, unknown> {
    const withCreditSign = isCreditInvoiceRow(row)
        ? negateCreditInvoiceAmounts(row)
        : row;
    return rewriteRowCurrencies(withCreditSign);
}

export function transformAccount10149Batch(
    batch: ExtensionMappedBatch
): ExtensionMappedBatch {
    const invoices = batch.Invoice;
    const payments = batch.Payment;
    const nextInvoices =
        invoices && invoices.length > 0
            ? invoices.map(transformInvoiceRow)
            : invoices;
    const nextPayments =
        payments && payments.length > 0
            ? payments.map(rewriteRowCurrencies)
            : payments;

    if (nextInvoices === invoices && nextPayments === payments) {
        return batch;
    }

    return {
        ...batch,
        ...(nextInvoices !== invoices ? { Invoice: nextInvoices } : {}),
        ...(nextPayments !== payments ? { Payment: nextPayments } : {}),
    };
}

export const account10149Extension: BillingAccountExtension = {
    key: ACCOUNT_10149_EXTENSION_KEY,
    label: "Account 10149",
    transform(ctx: ExtensionTransformContext): ExtensionMappedBatch {
        return transformAccount10149Batch(ctx.batch);
    },
    isForcePaidClose: isAccount10149ForcePaidClose,
    shouldNormalizeNegativeCreditPayments:
        shouldNormalizeAccount10149NegativeCreditPayments,
    normalizePaymentCurrency: normalizeAccount10149PaymentCurrency,
};
