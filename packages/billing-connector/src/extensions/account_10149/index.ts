import type {
    BillingAccountExtension,
    ExtensionAfterPaymentLinkedContext,
    ExtensionAfterPaymentLinkedResult,
    ExtensionAlignPaymentAmountsInput,
    ExtensionAlignedPaymentAmounts,
    ExtensionEntityType,
    ExtensionMappedBatch,
    ExtensionTransformContext,
} from "../types";
import { countUniquePendingCloseInvoiceNumbers } from "../pendingCloseProgress";
import { parseErpDateOnly } from "../../utils/connectorFieldUtils";
import { deriveInvoiceFxRatio } from "../../payment/alignPaymentToInvoiceCurrency";
import { escapeODataStringLiteral } from "../../services/billingConnectorPullFilterCompile";
import { tracePaymentImport } from "../../import/paymentImportTrace";
import {
    applyReconciledVirtualCloses,
    applyReconciledVirtualClosesForInvoiceNumbers,
} from "./reconciledVirtualClose";

/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon virtual close. */
export const ACCOUNT_10149_EXTENSION_KEY = "account_10149";
export const ACCOUNT_10149_ID = 10149;
export const ILS_CURRENCY_CODE = "ILS";
export const USD_CURRENCY_CODE = "USD";

/**
 * Priority company codes on IDG_ARFNCITEMS4. IDG_CUSTNAME is often
 * customer_number + company without leading zeros ("002" → suffix "02").
 * Override via extension_config.idgPaymentCompanyCodes.
 */
export const ACCOUNT_10149_DEFAULT_IDG_PAYMENT_COMPANY_CODES = [
    "000",
    "002",
] as const;

/**
 * Account-specific IDG_* / IDC_* columns required on IDG_ARFNCITEMS4 Payment pulls.
 * Kept out of generic PAYMENT_ALWAYS_SELECT_SOURCES.
 */
export const ACCOUNT_10149_PAYMENT_EXTRA_SELECT_FIELDS = [
    "IDC_CUSTNAMEIV",
    "IDG_CUSTNAME",
] as const;

const IDG_PAYMENT_COMPANY_CODES_CONFIG_KEY = "idgPaymentCompanyCodes";

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

function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * Priority IDG_ARFNCITEMS4 dual currency:
 * CODE + CREDIT1/DEBIT1 (primary) and CODE5 + CREDIT5/DEBIT5 (secondary).
 * Pick the side matching the invoice currency; keep the other as base amount.
 *
 * Receipt lines (FNCPATNAME "ק") carry only the primary side — Priority books
 * the dual currency on the invoice/debit line — so when neither side matches the
 * invoice we convert the primary amount with the invoice's own FX ratio.
 */
export function alignAccount10149PaymentAmountsForInvoice(
    input: ExtensionAlignPaymentAmountsInput
): ExtensionAlignedPaymentAmounts {
    const raw = input.rawErpRow;
    const invoiceCurrency = normalizeAccount10149PaymentCurrency(
        input.invoiceCustomerCurrency
    );
    if (!invoiceCurrency) {
        return absAlignedCancelDebitAmounts(raw, {
            amount: input.amount,
            customer_amount: input.customer_amount,
            customer_currency: input.customer_currency,
        });
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
    const invoiceFxRatio = deriveInvoiceFxRatio(
        input.invoiceAmount,
        input.invoiceCustomerAmount
    );
    // Only the primary side exists (no CODE5) and it is not the invoice currency.
    const needsInvoiceFxConversion =
        code !== invoiceCurrency &&
        code5 === "" &&
        amount1 !== null &&
        invoiceFxRatio !== null;

    const aligned: ExtensionAlignedPaymentAmounts =
        code5 === invoiceCurrency && amount5 !== null
            ? {
                  amount: amount1 ?? input.amount,
                  customer_amount: amount5,
                  customer_currency: invoiceCurrencyRaw,
              }
            : code === invoiceCurrency && amount1 !== null
              ? {
                    amount: amount5 ?? input.amount ?? amount1,
                    customer_amount: amount1,
                    customer_currency: invoiceCurrencyRaw,
                }
              : needsInvoiceFxConversion
                ? {
                      amount: amount1!,
                      customer_amount: roundCurrency(
                          amount1! / invoiceFxRatio!
                      ),
                      customer_currency: invoiceCurrencyRaw,
                  }
                : {
                      amount: input.amount,
                      customer_amount: input.customer_amount,
                      customer_currency: input.customer_currency,
                  };

    return absAlignedCancelDebitAmounts(raw, aligned);
}

/** Keep Helam cancel DEBIT1 from reintroducing a negative customer_amount. */
function absAlignedCancelDebitAmounts(
    raw: Record<string, unknown>,
    aligned: ExtensionAlignedPaymentAmounts
): ExtensionAlignedPaymentAmounts {
    const credit1 = toFiniteNumber(raw.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1) ?? 0;
    if (!(credit1 === 0 && debit1 < 0)) {
        return aligned;
    }
    return {
        amount:
            aligned.amount !== undefined
                ? Math.abs(aligned.amount)
                : aligned.amount,
        customer_amount: Math.abs(aligned.customer_amount),
        customer_currency: aligned.customer_currency,
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

function pickInvoiceNumber(
    raw: Record<string, unknown>,
    row: Record<string, unknown>
): string | null {
    return (
        asNonEmptyString(raw.IVNUM) ??
        asNonEmptyString(row.invoice_number) ??
        asNonEmptyString(raw.FNCIREF1) ??
        asNonEmptyString(raw.PAY_INVOICE_NUMBER) ??
        asNonEmptyString(row.PAY_INVOICE_NUMBER)
    );
}

/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt; queue IVNUM for
 * virtual close instead (IDG_ARFNCITEMS4 only contains closed lines).
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
 * Single-invoice cancels (IVNUM === FNCIREF1) still import as payments.
 * Two-invoice offset stamps (IVNUM ≠ FNCIREF1) are dropped and stamp-closed.
 */
export function isAccount10149CancelDebitPaymentRow(
    row: Record<string, unknown>
): boolean {
    const raw = rawRecordOf(row);
    const credit1 = toFiniteNumber(raw.CREDIT1 ?? row.CREDIT1) ?? 0;
    const debit1 = toFiniteNumber(raw.DEBIT1 ?? row.DEBIT1) ?? 0;
    return credit1 === 0 && debit1 < 0;
}

/**
 * Helam cancel stamp that offsets a different invoice: IVNUM (cancel doc) ≠
 * FNCIREF1 (original). Both invoices close each other — no payment, no virtual.
 */
export function isAccount10149HelamOffsetCancelRow(
    row: Record<string, unknown>
): boolean {
    if (!isAccount10149CancelDebitPaymentRow(row)) {
        return false;
    }
    const raw = rawRecordOf(row);
    const merged = { ...row, ...raw };
    if (!isAccount10149ReconciledClose(merged)) {
        return false;
    }
    const cancelInvoice = asNonEmptyString(raw.IVNUM);
    const originalInvoice = asNonEmptyString(raw.FNCIREF1);
    return (
        cancelInvoice != null &&
        originalInvoice != null &&
        cancelInvoice !== originalInvoice
    );
}

export type HelamOffsetPairTargets = {
    /** Original invoice numbers (FNCIREF1). */
    originals: Set<string>;
    /** Cancel stamp invoice numbers (IVNUM). */
    cancels: Set<string>;
};

/** Scan a payment batch for Helam offset cancel stamps (IVNUM ≠ FNCIREF1). */
export function collectHelamOffsetPairTargets(
    payments: Record<string, unknown>[]
): HelamOffsetPairTargets {
    const originals = new Set<string>();
    const cancels = new Set<string>();
    for (const row of payments) {
        if (!isAccount10149HelamOffsetCancelRow(row)) {
            continue;
        }
        const raw = rawRecordOf(row);
        const cancelInvoice = asNonEmptyString(raw.IVNUM);
        const originalInvoice = asNonEmptyString(raw.FNCIREF1);
        if (cancelInvoice && originalInvoice) {
            cancels.add(cancelInvoice);
            originals.add(originalInvoice);
        }
    }
    return { originals, cancels };
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
 * Reconciled IDG_ARFNCITEMS4 line that should settle the linked invoice.
 * Table only returns closed AR lines — FRECONNUM + invoice + BAL=0 is enough
 * (receipt CREDIT1≠0, Helam cancel, or invoice-side debit with no cash).
 */
export function isAccount10149ReconciledClose(
    rawErpRow: Record<string, unknown>
): boolean {
    const invoiceNumber =
        asNonEmptyString(rawErpRow.IVNUM) ??
        asNonEmptyString(rawErpRow.FNCIREF1) ??
        asNonEmptyString(rawErpRow.PAY_INVOICE_NUMBER);
    const bal = toFiniteNumber(rawErpRow.BAL) ?? 0;
    return hasFreconnum(rawErpRow) && invoiceNumber != null && bal === 0;
}

/** @deprecated Use {@link isAccount10149ReconciledClose}. */
export function isAccount10149ReconciledReceiptClose(
    rawErpRow: Record<string, unknown>
): boolean {
    return isAccount10149ReconciledClose(rawErpRow);
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

/**
 * Priority COMPANYNAME → IDG_CUSTNAME suffix.
 * "000" → none (plain customer number); "002" → "02" (not "2").
 */
export function account10149CompanySuffix(
    companyCode: string | null | undefined
): string {
    if (typeof companyCode !== "string") {
        return "";
    }
    const trimmed = companyCode.trim();
    if (!trimmed || /^0+$/.test(trimmed)) {
        return "";
    }
    // 3-digit company codes drop one leading zero in IDG_CUSTNAME ("002" → "02").
    if (/^0\d{2}$/.test(trimmed)) {
        return trimmed.slice(1);
    }
    return trimmed.replace(/^0+/, "") || "";
}

export function resolveAccount10149IdgPaymentCompanyCodes(
    extensionConfig: Record<string, unknown> | null | undefined
): string[] {
    const raw = extensionConfig?.[IDG_PAYMENT_COMPANY_CODES_CONFIG_KEY];
    if (Array.isArray(raw)) {
        const fromConfig = raw
            .map((value) => String(value ?? "").trim())
            .filter((value) => value.length > 0);
        if (fromConfig.length > 0) {
            return fromConfig;
        }
    }
    return [...ACCOUNT_10149_DEFAULT_IDG_PAYMENT_COMPANY_CODES];
}

/**
 * Archaser customer_number plus IDG company-suffixed variants for Payment pulls.
 */
export function expandAccount10149IdgCustomerNumbers(
    customerNumber: string,
    companyCodes: string[]
): string[] {
    const base = customerNumber.trim();
    if (!base) {
        return [];
    }
    const values = new Set<string>([base]);
    for (const code of companyCodes) {
        const suffix = account10149CompanySuffix(code);
        if (suffix) {
            values.add(`${base}${suffix}`);
        }
    }
    return [...values];
}

function isAccount10149IdgPaymentEntitySet(
    entityType: ExtensionEntityType | string,
    entitySet?: string | null
): boolean {
    if (entityType !== "Payment") {
        return false;
    }
    const setName = (entitySet ?? "").trim().toUpperCase();
    return setName.includes("IDG_ARFNCITEMS") || setName.startsWith("IDG_");
}

function odataEqAny(field: string, values: string[]): string | null {
    const clauses = values
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .map((value) => `${field} eq ${escapeODataStringLiteral(value)}`);
    if (clauses.length === 0) {
        return null;
    }
    if (clauses.length === 1) {
        return clauses[0] ?? null;
    }
    return `(${clauses.join(" or ")})`;
}

/**
 * IDG_ARFNCITEMS4 customer scope (fast path): company-suffixed IDG_CUSTNAME.
 * IDC_CUSTNAMEIV is a separate fallback query — OR'ing it here makes Priority
 * full-scan the form and hang preview/backfill for minutes.
 */
export function buildAccount10149RuntimeCustomerScopeOData(params: {
    customerNumber: string;
    additionalCustomerNumbers?: string[];
    entityType: ExtensionEntityType | string;
    entitySet?: string | null;
}): string | null {
    if (!isAccount10149IdgPaymentEntitySet(params.entityType, params.entitySet)) {
        return null;
    }
    const values = new Set<string>();
    const base = params.customerNumber.trim();
    if (base) {
        values.add(base);
    }
    for (const extra of params.additionalCustomerNumbers ?? []) {
        const trimmed = typeof extra === "string" ? extra.trim() : "";
        if (trimmed) {
            values.add(trimmed);
        }
    }
    return odataEqAny("IDG_CUSTNAME", [...values]);
}

/**
 * Fallback scope for Helam/VAT lines where IDG_CUSTNAME is empty and the
 * customer is only on IDC_CUSTNAMEIV (base Archaser customer_number).
 * Run as a second Payment pull — do not OR into the IDG_CUSTNAME filter.
 *
 * Do not add `IDG_CUSTNAME eq null` / `eq ''` here — Priority returns HTTP 500
 * ("Object reference not set…") on that clause. Drop non-empty IDG rows
 * client-side after the pull instead.
 */
export function buildAccount10149IdcFallbackCustomerScopeOData(params: {
    customerNumber: string;
    entityType: ExtensionEntityType | string;
    entitySet?: string | null;
}): string | null {
    if (!isAccount10149IdgPaymentEntitySet(params.entityType, params.entitySet)) {
        return null;
    }
    const base = params.customerNumber.trim();
    if (!base) {
        return null;
    }
    return odataEqAny("IDC_CUSTNAMEIV", [base]);
}

/**
 * Map IDG_CUSTNAME / mapped customer_number back to Archaser customer_number
 * using COMPANYNAME on the ERP row when present, else known company suffixes.
 */
export function normalizeAccount10149PaymentCustomerNumber(
    customerNumber: string | null | undefined,
    options?: {
        companyName?: string | null;
        companyCodes?: string[];
    }
): string {
    const value =
        typeof customerNumber === "string" ? customerNumber.trim() : "";
    if (!value) {
        return value;
    }
    const fromCompany = account10149CompanySuffix(options?.companyName);
    if (
        fromCompany &&
        value.endsWith(fromCompany) &&
        value.length > fromCompany.length
    ) {
        return value.slice(0, -fromCompany.length);
    }
    const codes =
        options?.companyCodes ??
        [...ACCOUNT_10149_DEFAULT_IDG_PAYMENT_COMPANY_CODES];
    const suffixes = codes
        .map(account10149CompanySuffix)
        .filter((suffix) => suffix.length > 0)
        .sort((a, b) => b.length - a.length);
    for (const suffix of suffixes) {
        if (value.endsWith(suffix) && value.length > suffix.length) {
            return value.slice(0, -suffix.length);
        }
    }
    return value;
}

function transformPaymentRow(
    row: Record<string, unknown>,
    companyCodes: string[]
): Record<string, unknown> | null {
    const next = normalizeAccount10149PaymentCustomerOnRow(row, companyCodes);
    if (isAccount10149CancelDebitPaymentRow(next)) {
        return rewriteRowCurrencies(absCancelPaymentAmounts(next));
    }
    if (isAccount10149DebitPaymentRow(next)) {
        return null;
    }
    return rewriteRowCurrencies(next);
}

function normalizeAccount10149PaymentCustomerOnRow(
    row: Record<string, unknown>,
    companyCodes: string[]
): Record<string, unknown> {
    const raw = rawRecordOf(row);
    const normalizedCustomer = normalizeAccount10149PaymentCustomerNumber(
        typeof row.customer_number === "string"
            ? row.customer_number
            : asNonEmptyString(raw.IDG_CUSTNAME) ??
                  asNonEmptyString(raw.CUSTNAME) ??
                  asNonEmptyString(raw.IDC_CUSTNAMEIV),
        {
            companyName:
                asNonEmptyString(raw.COMPANYNAME) ??
                asNonEmptyString(row.COMPANYNAME),
            companyCodes,
        }
    );
    if (
        !normalizedCustomer ||
        normalizedCustomer === String(row.customer_number ?? "").trim()
    ) {
        return row;
    }
    return { ...row, customer_number: normalizedCustomer };
}

/**
 * Priority credit-note invoice numbers (e.g. CR26100000032) — recon lines for
 * these are not cash receipts; queue virtual close instead of importing payment.
 */
export function isAccount10149CreditInvoiceNumber(
    invoiceNumber: string | null | undefined
): boolean {
    const trimmed = invoiceNumber?.trim() ?? "";
    return trimmed.length > 0 && /^CR/i.test(trimmed);
}

function queueReconciledInvoiceClose(
    invoiceNumber: string | null | undefined,
    raw: Record<string, unknown>,
    row: Record<string, unknown>,
    queuedCloseNumbers: string[],
    queuedCloseDates: Map<string, Date>
): void {
    const trimmed = invoiceNumber?.trim() ?? "";
    if (!trimmed) {
        return;
    }
    queuedCloseNumbers.push(trimmed);
    const curDate = parseErpDateOnly(raw.CURDATE ?? row.CURDATE);
    if (curDate) {
        queuedCloseDates.set(trimmed, curDate);
    }
}

function paymentRowHasCustomerNumber(row: Record<string, unknown>): boolean {
    const fromMapped =
        typeof row.customer_number === "string"
            ? row.customer_number.trim()
            : "";
    if (fromMapped.length > 0) {
        return true;
    }
    const raw = rawRecordOf(row);
    return (
        asNonEmptyString(raw.IDG_CUSTNAME) != null ||
        asNonEmptyString(raw.CUSTNAME) != null ||
        asNonEmptyString(raw.IDC_CUSTNAMEIV) != null
    );
}

/**
 * Customer cash receipt (or single-invoice Helam cancel): import as payment.
 * Includes VAT / tax ledger lines when a customer id is present.
 * Positive debits, CR* notes, and Helam two-invoice offsets are virtual-queue only.
 */
export function shouldImportAccount10149CashPayment(
    row: Record<string, unknown>
): boolean {
    if (!paymentRowHasCustomerNumber(row)) {
        return false;
    }
    if (isAccount10149HelamOffsetCancelRow(row)) {
        return false;
    }
    if (isAccount10149DebitPaymentRow(row)) {
        return false;
    }
    const raw = rawRecordOf(row);
    const ivnum = pickInvoiceNumber(raw, row);
    if (isAccount10149CreditInvoiceNumber(ivnum)) {
        return false;
    }
    return true;
}

/**
 * IDG_ARFNCITEMS4 only returns closed AR lines. Any reconciled row
 * (FRECONNUM + invoice + BAL=0) queues virtual close by invoice number.
 * Customer receipts (including VAT ledger lines with a customer id) import as
 * cash; virtual fills remaining. Helam offset cancels queue both IVNUM and
 * FNCIREF1 (no stamp-close).
 */
export function transformAccount10149Batch(
    batch: ExtensionMappedBatch,
    options?: {
        /** Invoice numbers queued for flush virtual close. */
        onReconciledInvoiceCloseTargets?: (
            invoiceNumbers: string[],
            /** ERP CURDATE per invoice number, when the line carries one. */
            closeDates?: Map<string, Date>
        ) => void;
        extension_config?: Record<string, unknown> | null;
    }
): ExtensionMappedBatch {
    const companyCodes = resolveAccount10149IdgPaymentCompanyCodes(
        options?.extension_config
    );
    const invoices = batch.Invoice;
    const payments = batch.Payment;
    const nextInvoices =
        invoices && invoices.length > 0
            ? invoices.map(transformInvoiceRow)
            : invoices;
    let nextPayments = payments;
    if (payments && payments.length > 0) {
        const queuedCloseNumbers: string[] = [];
        const queuedCloseDates = new Map<string, Date>();
        const kept: Record<string, unknown>[] = [];
        for (const row of payments) {
            const normalizedRow = normalizeAccount10149PaymentCustomerOnRow(
                row,
                companyCodes
            );
            const raw = rawRecordOf(normalizedRow);
            const reconciled = isAccount10149ReconciledClose({
                ...normalizedRow,
                ...raw,
            });
            const ivnum = pickInvoiceNumber(raw, normalizedRow);
            const fnciref1 = asNonEmptyString(raw.FNCIREF1);
            const helamOffset =
                reconciled && isAccount10149HelamOffsetCancelRow(normalizedRow);

            if (reconciled) {
                queueReconciledInvoiceClose(
                    ivnum,
                    raw,
                    normalizedRow,
                    queuedCloseNumbers,
                    queuedCloseDates
                );
                // Helam two-invoice cancel: also close the original (FNCIREF1).
                if (
                    helamOffset &&
                    fnciref1 &&
                    fnciref1 !== (ivnum?.trim() ?? "")
                ) {
                    queueReconciledInvoiceClose(
                        fnciref1,
                        raw,
                        normalizedRow,
                        queuedCloseNumbers,
                        queuedCloseDates
                    );
                }
            }

            if (!shouldImportAccount10149CashPayment(normalizedRow)) {
                tracePaymentImport("extension_drop", normalizedRow, {
                    reason: helamOffset
                        ? "helam_offset_virtual_close"
                        : isAccount10149DebitPaymentRow(normalizedRow)
                          ? "reconciled_debit_virtual_close"
                          : isAccount10149CreditInvoiceNumber(ivnum)
                            ? "credit_invoice_virtual_close"
                            : !paymentRowHasCustomerNumber(normalizedRow)
                              ? "missing_customer_number"
                              : "cash_import_skipped",
                    reconciled,
                    ivnum,
                    queuedVirtualClose: reconciled ? ivnum ?? null : null,
                });
                continue;
            }

            const transformed = transformPaymentRow(
                normalizedRow,
                companyCodes
            );
            if (transformed != null) {
                tracePaymentImport("extension_keep", transformed, {
                    reason: isAccount10149CancelDebitPaymentRow(row)
                        ? "helam_cancel_debit_import"
                        : "receipt_import",
                    reconciled,
                    queuedVirtualClose: reconciled ? ivnum ?? null : null,
                });
                kept.push(transformed);
            } else {
                tracePaymentImport("extension_drop", row, {
                    reason: "transformPaymentRow_null_debit",
                    isDebit: isAccount10149DebitPaymentRow(row),
                    isCancelDebit: isAccount10149CancelDebitPaymentRow(row),
                    reconciled,
                });
            }
        }
        if (queuedCloseNumbers.length > 0) {
            options?.onReconciledInvoiceCloseTargets?.(
                queuedCloseNumbers,
                queuedCloseDates
            );
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
    const closeCandidates = ctx.candidates.filter((candidate) =>
        isAccount10149ReconciledClose(candidate.rawErpRow)
    );
    if (closeCandidates.length === 0) {
        return { invoiceIdsToRecalc: [] };
    }
    const touched = await applyReconciledVirtualCloses(
        ctx.prisma,
        ctx.accountId,
        closeCandidates.map((candidate) => ({
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
    expandRuntimeCustomerScopeNumbers(params) {
        if (
            !isAccount10149IdgPaymentEntitySet(
                params.entityType,
                params.entitySet
            )
        ) {
            return [];
        }
        const companyCodes = resolveAccount10149IdgPaymentCompanyCodes(
            params.extension_config
        );
        return expandAccount10149IdgCustomerNumbers(
            params.customerNumber,
            companyCodes
        );
    },
    extraSelectFields(params) {
        if (
            !isAccount10149IdgPaymentEntitySet(
                params.entityType,
                params.entitySet
            )
        ) {
            return [];
        }
        return [...ACCOUNT_10149_PAYMENT_EXTRA_SELECT_FIELDS];
    },
    buildRuntimeCustomerScopeOData(params) {
        return buildAccount10149RuntimeCustomerScopeOData({
            customerNumber: params.customerNumber,
            additionalCustomerNumbers: params.additionalCustomerNumbers,
            entityType: params.entityType,
            entitySet: params.entitySet,
        });
    },
    buildRuntimeCustomerScopeFallbackOData(params) {
        return buildAccount10149IdcFallbackCustomerScopeOData({
            customerNumber: params.customerNumber,
            entityType: params.entityType,
            entitySet: params.entitySet,
        });
    },
    async transform(
        ctx: ExtensionTransformContext
    ): Promise<ExtensionMappedBatch> {
        return transformAccount10149Batch(ctx.batch, {
            extension_config: ctx.extension_config,
            onReconciledInvoiceCloseTargets: (invoiceNumbers, closeDates) => {
                if (ctx.pendingInvoiceCloses) {
                    for (const invoiceNumber of invoiceNumbers) {
                        ctx.pendingInvoiceCloses.add(invoiceNumber);
                    }
                }
                if (ctx.pendingInvoiceCloseDates && closeDates) {
                    for (const [invoiceNumber, date] of closeDates) {
                        ctx.pendingInvoiceCloseDates.set(invoiceNumber, date);
                    }
                }
            },
        });
    },
    afterPaymentLinked: afterAccount10149PaymentLinked,
    async flushPendingInvoiceCloses(ctx) {
        const closedIds = new Set<number>();
        const customerIds = new Set<number>();

        const total = countUniquePendingCloseInvoiceNumbers(ctx.invoiceNumbers);
        const report = (processed: number) => {
            if (total <= 0) {
                return;
            }
            ctx.onProgress?.({
                processed: Math.min(processed, total),
                total,
            });
        };
        if (total > 0) {
            report(0);
        }

        let processed = 0;

        if (ctx.invoiceNumbers.length > 0) {
            const result = await applyReconciledVirtualClosesForInvoiceNumbers(
                ctx.prisma,
                ctx.accountId,
                ctx.invoiceNumbers,
                ctx.userId,
                ctx.invoiceCloseDates
            );
            processed += result.missingNumbers.length;
            report(processed);

            const recalcBaseline = processed;
            const recalcTotal = result.touchedIds.length;

            if (result.touchedIds.length > 0) {
                // Dynamic import avoids account_10149 ↔ extensions ↔ recalc cycle.
                const { recalculateInvoicesFromLinkedPayments } = await import(
                    "../../invoice/linkDeferredPaymentAndRecalc"
                );
                await recalculateInvoicesFromLinkedPayments(
                    ctx.prisma,
                    new Map(
                        result.touchedIds.map((invoiceId) => [invoiceId, {}])
                    ),
                    {
                        onProgress: ({ processed: recalcProcessed }) => {
                            report(recalcBaseline + recalcProcessed);
                        },
                    }
                );
            }
            processed = recalcBaseline + recalcTotal;
            report(processed);

            for (const id of result.touchedIds) {
                closedIds.add(id);
            }
            for (const id of result.customerIds) {
                customerIds.add(id);
            }
        }

        if (total > 0) {
            report(total);
        }

        return {
            closedIds: [...closedIds],
            customerIds: [...customerIds],
        };
    },
    normalizePaymentCurrency: normalizeAccount10149PaymentCurrency,
    alignPaymentAmountsForInvoice: alignAccount10149PaymentAmountsForInvoice,
};
