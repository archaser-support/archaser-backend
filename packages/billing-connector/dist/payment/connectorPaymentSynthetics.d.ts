/**
 * Flatten Priority payment source rows into synthetic fields expected by mapping.
 *
 * IDG_ARFNCITEMS4 (and similar AR line feeds):
 * - PAY_AMOUNT = non-zero CREDIT1 else DEBIT1 (else CREDIT/DEBIT)
 * - PAY_DATE = FNCDATE else BALDATE
 * - PAY_REFERENCE = FRECONNUM|FNCNUM(|KLINE) when recon is present;
 *   else FNCNUM(|KLINE); else IVNUM/PAYNUM fallbacks
 * - PAYDES = trimmed FNCPATNAME when present (maps to payment_method)
 */
/**
 * Canonical payment reference for import identity.
 * Prefer FRECONNUM|FNCNUM so split settlements group and cancel lines stay unique.
 */
export declare function buildPaymentReference(row: Record<string, unknown>): string | undefined;
/**
 * All reference strings that can identify the same ERP payment line.
 * Used so a re-sync matches rows stored as IVNUM|KLINE or FNCNUM|KLINE.
 */
export declare function collectPaymentReferenceAliases(row: Record<string, unknown>, mappedReference?: string, invoiceNumber?: string): string[];
export declare const PAYMENT_SYNTHETIC_FIELDS: readonly ["PAY_AMOUNT", "PAY_DATE", "PAY_REFERENCE", "PAY_INVOICE_NUMBER"];
/**
 * Returns a shallow copy with synthetic payment fields applied.
 * Does not drop rows — callers filter via pull filters / validation.
 */
export declare function applyPaymentSynthetics(row: Record<string, unknown>): Record<string, unknown>;
export declare function applyPaymentSyntheticsToRecords(records: Record<string, unknown>[]): Record<string, unknown>[];
