import type { BillingAccountExtension, ExtensionAfterPaymentLinkedContext, ExtensionAfterPaymentLinkedResult, ExtensionAlignPaymentAmountsInput, ExtensionAlignedPaymentAmounts, ExtensionCreditPaymentCloseInput, ExtensionMappedBatch } from "../types";
/** Account 10149 billing extension — credit sign, shekel→ILS, $→USD, recon close, Helam cancel payments, credit abs payments. */
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
 */
export declare function alignAccount10149PaymentAmountsForInvoice(input: ExtensionAlignPaymentAmountsInput): ExtensionAlignedPaymentAmounts;
/**
 * Invoice-side AR recon debit: positive DEBIT1, zero CREDIT1.
 * Drop these so they do not double-count vs the receipt.
 * Negative DEBIT1 is a Helam cancel line — keep as a closing payment.
 */
export declare function isAccount10149DebitPaymentRow(row: Record<string, unknown>): boolean;
/**
 * Helam (or similar) cancel AR line: negative DEBIT1, zero CREDIT1.
 * Import as a positive payment against FNCIREF1 so the original invoice can close.
 */
export declare function isAccount10149CancelDebitPaymentRow(row: Record<string, unknown>): boolean;
/**
 * Reconciled receipt that should close the linked invoice (D2).
 */
export declare function isAccount10149ReconciledReceiptClose(rawErpRow: Record<string, unknown>): boolean;
export declare function shouldNormalizeAccount10149NegativeCreditPayments(row: ExtensionCreditPaymentCloseInput): boolean;
export declare function transformAccount10149Batch(batch: ExtensionMappedBatch): ExtensionMappedBatch;
export declare function afterAccount10149PaymentLinked(ctx: ExtensionAfterPaymentLinkedContext): Promise<ExtensionAfterPaymentLinkedResult>;
export declare const account10149Extension: BillingAccountExtension;
