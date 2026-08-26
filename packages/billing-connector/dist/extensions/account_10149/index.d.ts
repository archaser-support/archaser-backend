import type { BillingAccountExtension, ExtensionMappedBatch } from "../types";
/** Account 10149 billing extension — credit amount sign and shekel currency alias. */
export declare const ACCOUNT_10149_EXTENSION_KEY = "account_10149";
export declare const ACCOUNT_10149_ID = 10149;
export declare const ILS_CURRENCY_CODE = "ILS";
export declare function isHebrewShekelCurrencyLabel(value: unknown): boolean;
export declare function normalizeAccount10149PaymentCurrency(currency: string | null | undefined): string;
export declare function transformAccount10149Batch(batch: ExtensionMappedBatch): ExtensionMappedBatch;
export declare const account10149Extension: BillingAccountExtension;
