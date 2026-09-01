import type { BillingAccountExtension, ExtensionAfterPaymentLinkedContext, ExtensionAfterPaymentLinkedResult, ExtensionAlignPaymentAmountsInput, ExtensionAlignedPaymentAmounts, ExtensionCreditPaymentCloseInput, ExtensionMappedBatch } from "../types";
/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon virtual close, Helam offset stamp, credit abs payments. */
export declare const ACCOUNT_10149_EXTENSION_KEY = "account_10149";
export declare const ACCOUNT_10149_ID = 10149;
export declare const ILS_CURRENCY_CODE = "ILS";
export declare const USD_CURRENCY_CODE = "USD";
export declare function isHebrewShekelCurrencyLabel(value: unknown): boolean;
/** Priority dollar symbol (and common US$ / USD$ variants) → USD. */
export declare function isDollarCurrencyLabel(value: unknown): boolean;
export declare function normalizeAccount10149PaymentCurrency(currency: string | null | undefined): string;
/**
 * Priority IDG_ARFNCITEMS4 dual currency:
 * CODE + CREDIT1/DEBIT1 (primary) and CODE5 + CREDIT5/DEBIT5 (secondary).
 * Pick the side matching the invoice currency; keep the other as base amount.
 *
 * Receipt lines (FNCPATNAME "ק") carry only the primary side — Priority books
 * the dual currency on the invoice/debit line — so when neither side matches the
 * invoice we convert the primary amount with the invoice's own FX ratio.
 */
export declare function alignAccount10149PaymentAmountsForInvoice(input: ExtensionAlignPaymentAmountsInput): ExtensionAlignedPaymentAmounts;
/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt; queue IVNUM for
 * virtual close instead (IDG_ARFNCITEMS4 only contains closed lines).
 */
export declare function isAccount10149DebitPaymentRow(row: Record<string, unknown>): boolean;
/**
 * Helam (or similar) cancel AR line: negative DEBIT1, zero CREDIT1.
 * Single-invoice cancels (IVNUM === FNCIREF1) still import as payments.
 * Two-invoice offset stamps (IVNUM ≠ FNCIREF1) are dropped and stamp-closed.
 */
export declare function isAccount10149CancelDebitPaymentRow(row: Record<string, unknown>): boolean;
/**
 * Helam cancel stamp that offsets a different invoice: IVNUM (cancel doc) ≠
 * FNCIREF1 (original). Both invoices close each other — no payment, no virtual.
 */
export declare function isAccount10149HelamOffsetCancelRow(row: Record<string, unknown>): boolean;
export type HelamOffsetPairTargets = {
    /** Original invoice numbers (FNCIREF1). */
    originals: Set<string>;
    /** Cancel stamp invoice numbers (IVNUM). */
    cancels: Set<string>;
};
/** Scan a payment batch for Helam offset cancel stamps (IVNUM ≠ FNCIREF1). */
export declare function collectHelamOffsetPairTargets(payments: Record<string, unknown>[]): HelamOffsetPairTargets;
/**
 * Reconciled IDG_ARFNCITEMS4 line that should settle the linked invoice.
 * Table only returns closed AR lines — FRECONNUM + invoice + BAL=0 is enough
 * (receipt CREDIT1≠0, Helam cancel, or invoice-side debit with no cash).
 */
export declare function isAccount10149ReconciledClose(rawErpRow: Record<string, unknown>): boolean;
/** @deprecated Use {@link isAccount10149ReconciledClose}. */
export declare function isAccount10149ReconciledReceiptClose(rawErpRow: Record<string, unknown>): boolean;
export declare function shouldNormalizeAccount10149NegativeCreditPayments(row: ExtensionCreditPaymentCloseInput): boolean;
/**
 * Priority credit-note invoice numbers (e.g. CR26100000032) — recon lines for
 * these are not cash receipts; queue virtual close instead of importing payment.
 */
export declare function isAccount10149CreditInvoiceNumber(invoiceNumber: string | null | undefined): boolean;
/**
 * Drop invoice-side positive debits and reconciled credit-note (CR*) lines;
 * queue their IVNUMs for virtual close. Keep normal receipts and single-invoice
 * Helam cancels (IVNUM === FNCIREF1) for payment import + afterPaymentLinked.
 * Helam offset stamps (IVNUM ≠ FNCIREF1) drop both sides and stamp-close both
 * invoices with no virtual payment.
 */
export declare function transformAccount10149Batch(batch: ExtensionMappedBatch, options?: {
    /** Invoice numbers from dropped reconciled debit / CR* lines. */
    onReconciledInvoiceCloseTargets?: (invoiceNumbers: string[], 
    /** ERP CURDATE per invoice number, when the line carries one. */
    closeDates?: Map<string, Date>) => void;
    /** Original + cancel stamp numbers for Helam offset pair stamp-close. */
    onHelamOffsetCloseTargets?: (invoiceNumbers: string[]) => void;
}): ExtensionMappedBatch;
export declare function afterAccount10149PaymentLinked(ctx: ExtensionAfterPaymentLinkedContext): Promise<ExtensionAfterPaymentLinkedResult>;
export declare const account10149Extension: BillingAccountExtension;
