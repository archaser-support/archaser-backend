export type PolicyGapReadable = {
    capacity_gap_amount?: number | null;
    uninsured_amount?: number | null;
    capacity_gap_amount1?: number | null;
    capacity_gap_currency1?: string | null;
    capacity_gap_amount2?: number | null;
    capacity_gap_currency2?: string | null;
    uninsured_amount1?: number | null;
    uninsured_currency1?: string | null;
    uninsured_amount2?: number | null;
    uninsured_currency2?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean | null;
    insurance_policy_id?: number | null;
    policy_exclusion_reason?: string | null;
    approved_limit?: unknown;
};
export declare function isPolicyCapacityGapSuppressed(c: PolicyGapReadable): boolean;
export declare function storedCapacityGapAmount(c: PolicyGapReadable): number;
export declare function readCapacityGapForDisplay(c: PolicyGapReadable): number;
export type InvoiceCapacityGapRollup = {
    total: number | null;
    hasMissingSnapshots: boolean;
};
export declare function resolveCapacityGapForAtRisk(storedRow: PolicyGapReadable, _openAr: number, invoiceGap?: InvoiceCapacityGapRollup | null): number;
export declare function readUninsuredAmountForDisplay(c: PolicyGapReadable, openAr?: number | null): number | null;
export declare function storedCapacityGapInCurrency(c: PolicyGapReadable, currency: string): number | null;
export type PolicyRowForStoredGapSecondary = PolicyGapReadable & {
    insurance_policy_id?: number | null;
    is_active?: boolean;
};
export declare function sumStoredCapacityGapInCurrency(rows: PolicyGapReadable[], currency: string): number | null;
export declare function resolveStoredCapacityGapSecondary(rows: PolicyRowForStoredGapSecondary[], currency: string, options?: {
    policyId?: number;
}): number | null;
