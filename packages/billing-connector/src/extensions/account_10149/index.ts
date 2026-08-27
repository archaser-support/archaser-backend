import type {
    BillingAccountExtension,
    ExtensionAfterPaymentLinkedContext,
    ExtensionAfterPaymentLinkedResult,
    ExtensionAlignPaymentAmountsInput,
    ExtensionAlignedPaymentAmounts,
    ExtensionCreditPaymentCloseInput,
    ExtensionMappedBatch,
    ExtensionTransformContext,
} from "../types";
import { applyReconciledVirtualCloses } from "./reconciledVirtualClose";

/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon close, Helam cancel payments, credit abs payments. */
export const ACCOUNT_10149_EXTENSION_KEY = "account_10149";
export const ACCOUNT_10149_ID = 10149;
export const ILS_CURRENCY_CODE = "ILS";
export const USD_CURRENCY_CODE = "USD";

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

/** Priority dollar symbol (and common US$ / USD$ variants) → USD. */
export function isDollarCurrencyLabel(value: unknown): boolean {
    if (typeof value !== "string") {
        return false;
    }
    const trimmed = value.trim().replace(/\s+/g, "").toUpperCase();
    return trimmed === "$" || trimmed === "US$" || trimmed === "USD$";
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
    if (isDollarCurrencyLabel(currency)) {
        return USD_CURRENCY_CODE;
    }
    return currency.trim().toUpperCase();
}

function pickNonZeroAmount(...values: unknown[]): number | null {
    for (const value of values) {
        const n = toFiniteNumber(value);
        if (n !== undefined && n !== 0) {
            return n;
        }
    }
    return null;
}

/**
 * Priority IDG_ARFNCITEMS4 dual currency:
 * CODE + CREDIT1/DEBIT1 (primary) and CODE5 + CREDIT5/DEBIT5 (secondary).
 * Pick the side matching the invoice currency; keep the other as base amount.
 */
export function alignAccount10149PaymentAmountsForInvoice(
    input: ExtensionAlignPaymentAmountsInput
): ExtensionAlignedPaymentAmounts {
    const raw = input.rawErpRow;
    const invoiceCurrency = normalizeAccount10149PaymentCurrency(
        input.invoiceCustomerCurrency
    );
    if (!invoiceCurrency) {
        return {
            amount: input.amount,
            customer_amount: input.customer_amount,
            customer_currency: input.customer_currency,
        };
    }

    const code = normalizeAccount10149PaymentCurrency(
        (raw.CODE as string | null | undefined) ?? input.customer_currency
    );
    const code5 = normalizeAccount10149PaymentCurrency(
        raw.CODE5 as string | null | undefined
    );
    const amount1 = pickNonZeroAmount(raw.CREDIT1, raw.DEBIT1);
    const amount5 = pickNonZeroAmount(raw.CREDIT5, raw.DEBIT5);
    const invoiceCurrencyRaw =
        (input.invoiceCustomerCurrency ?? "").trim() ||
        input.customer_currency;

    if (code5 === invoiceCurrency && amount5 !== null) {
        return {
            amount: amount1 ?? input.amount,
            customer_amount: amount5,
            customer_currency: invoiceCurrencyRaw,
        };
    }

    if (code === invoiceCurrency && amount1 !== null) {
        return {
            amount: amount5 ?? input.amount ?? amount1,
            customer_amount: amount1,
            customer_currency: invoiceCurrencyRaw,
        };
    }

    return {
        amount: input.amount,
        customer_amount: input.customer_amount,
        customer_currency: input.customer_currency,
    };
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function hasFreconnum(raw: Record<string, unknown>): boolean {
    const freconnum = raw.FRECONNUM;
    if (typeof freconnum === "number" && Number.isFinite(freconnum)) {
        return true;
    }
    return typeof freconnum === "string" && freconnum.trim().length > 0;
}

function isIdigitalPaymentRow(raw: Record<string, unknown>): boolean {
    const fncnum = asNonEmptyString(raw.FNCNUM);
    const fnciref1 = asNonEmptyString(raw.FNCIREF1);
    return (fncnum != null && fnciref1 != null) || hasFreconnum(raw);
}

/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt.
 * Negative DEBIT1 is a Helam cancel line — keep as a closing payment.
 */
export function isAccount10149DebitPaymentRow(
    row: Record<string, unknown>
): boolean {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 > 0;
}

/**
 * Helam (or similar) cancel AR line: negative DEBIT1, zero CREDIT1.
 * Import as a positive payment against FNCIREF1 so the original invoice can close.
 */
export function isAccount10149CancelDebitPaymentRow(
    row: Record<string, unknown>
): boolean {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 < 0;
}

const PAYMENT_AMOUNT_FIELDS = ["amount", "customer_amount"] as const;

function absCancelPaymentAmounts(
    row: Record<string, unknown>
): Record<string, unknown> {
    const next: Record<string, unknown> = { ...row };
    for (const field of PAYMENT_AMOUNT_FIELDS) {
        const parsed = toFiniteNumber(next[field]);
        if (parsed !== undefined && parsed < 0) {
            next[field] = Math.abs(parsed);
        }
    }
    const raw = rawRecordOf(row);
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1);
    if (
        toFiniteNumber(next.amount) === undefined &&
        debit1 !== undefined &&
        debit1 < 0
    ) {
        next.amount = Math.abs(debit1);
    }
    if (
        toFiniteNumber(next.customer_amount) === undefined &&
        debit1 !== undefined &&
        debit1 < 0
    ) {
        next.customer_amount = Math.abs(debit1);
    }
    return next;
}

/**
 * Reconciled receipt that should close the linked invoice (D2).
 */
export function isAccount10149ReconciledReceiptClose(
    rawErpRow: Record<string, unknown>
): boolean {
    const fnciref1 =
        asNonEmptyString(rawErpRow.FNCIREF1) ??
        asNonEmptyString(rawErpRow.PAY_INVOICE_NUMBER);
    const bal = toFiniteNumber(rawErpRow.BAL) ?? 0;
    const credit1 = toFiniteNumber(rawErpRow.CREDIT1) ?? 0;
    return (
        hasFreconnum(rawErpRow) &&
        fnciref1 != null &&
        bal === 0 &&
        credit1 !== 0
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
        const current = next[field];
        if (isHebrewShekelCurrencyLabel(current)) {
            next[field] = ILS_CURRENCY_CODE;
            changed = true;
        } else if (isDollarCurrencyLabel(current)) {
            next[field] = USD_CURRENCY_CODE;
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

function transformPaymentRow(
    row: Record<string, unknown>
): Record<string, unknown> | null {
    if (isAccount10149CancelDebitPaymentRow(row)) {
        return rewriteRowCurrencies(absCancelPaymentAmounts(row));
    }
    if (isAccount10149DebitPaymentRow(row)) {
        return null;
    }
    return rewriteRowCurrencies(row);
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
    let nextPayments = payments;
    if (payments && payments.length > 0) {
        const kept: Record<string, unknown>[] = [];
        for (const row of payments) {
            const transformed = transformPaymentRow(row);
            if (transformed != null) {
                kept.push(transformed);
            }
        }
        nextPayments = kept;
    }

    if (nextInvoices === invoices && nextPayments === payments) {
        return batch;
    }

    return {
        ...batch,
        ...(nextInvoices !== invoices ? { Invoice: nextInvoices } : {}),
        ...(nextPayments !== payments ? { Payment: nextPayments } : {}),
    };
}

export async function afterAccount10149PaymentLinked(
    ctx: ExtensionAfterPaymentLinkedContext
): Promise<ExtensionAfterPaymentLinkedResult> {
    const reconciled = ctx.candidates.filter((candidate) =>
        isAccount10149ReconciledReceiptClose(candidate.rawErpRow)
    );
    if (reconciled.length === 0) {
        return { invoiceIdsToRecalc: [] };
    }
    const touched = await applyReconciledVirtualCloses(
        ctx.prisma,
        ctx.accountId,
        reconciled.map((candidate) => ({
            invoiceId: candidate.invoiceId,
            customerId: candidate.customerId,
            invoiceNumber: candidate.invoiceNumber,
            paymentDate: candidate.paymentDate,
        })),
        ctx.userId
    );
    return { invoiceIdsToRecalc: [...touched] };
}

export const account10149Extension: BillingAccountExtension = {
    key: ACCOUNT_10149_EXTENSION_KEY,
    label: "Account 10149",
    transform(ctx: ExtensionTransformContext): ExtensionMappedBatch {
        return transformAccount10149Batch(ctx.batch);
    },
    afterPaymentLinked: afterAccount10149PaymentLinked,
    shouldNormalizeNegativeCreditPayments:
        shouldNormalizeAccount10149NegativeCreditPayments,
    normalizePaymentCurrency: normalizeAccount10149PaymentCurrency,
    alignPaymentAmountsForInvoice: alignAccount10149PaymentAmountsForInvoice,
};
