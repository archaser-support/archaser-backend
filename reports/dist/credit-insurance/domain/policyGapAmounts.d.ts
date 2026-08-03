/**
 * Read helpers for stored CustomerPolicy gap / uninsured fields.
 * Writers use {@link computePolicyGapAmounts} only.
 */
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
/** Capacity gap is zeroed at read time when DCL is outdated or customer is uncovered. */
export declare function isPolicyCapacityGapSuppressed(c: PolicyGapReadable): boolean;
/** Stored KPI capacity gap on CustomerPolicy (rollup via {@link computePolicyCapacityGapKpi}). */
export declare function storedCapacityGapAmount(c: PolicyGapReadable): number;
/** @deprecated Use {@link storedCapacityGapAmount}. Kept for gradual call-site migration. */
export declare function readCapacityGapForDisplay(c: PolicyGapReadable): number;
export type InvoiceCapacityGapRollup = {
    total: number | null;
    hasMissingSnapshots: boolean;
};
/**
 * At-risk / health-index capacity gap: invoice snapshots are authoritative when
 * every open invoice has `limit_assessed_amount` (unchanged on limit/top-up
 * increases). Stored CustomerPolicy gap is fallback only when snapshots are missing.
 */
export declare function resolveCapacityGapForAtRisk(storedRow: PolicyGapReadable, _openAr: number, invoiceGap?: InvoiceCapacityGapRollup | null): number;
/** Display uninsured: full open AR when excluded; otherwise stored value floored at 0. */
export declare function readUninsuredAmountForDisplay(c: PolicyGapReadable, openAr?: number | null): number | null;
/** Secondary header line from policy bucket when currency matches. */
export declare function storedCapacityGapInCurrency(c: PolicyGapReadable, currency: string): number | null;
export type PolicyRowForStoredGapSecondary = PolicyGapReadable & {
    insurance_policy_id?: number | null;
    is_active?: boolean;
};
/** Sum stored limit-currency gap across rows (one active row per insurance policy). */
export declare function sumStoredCapacityGapInCurrency(rows: PolicyGapReadable[], currency: string): number | null;
/**
 * Capacity gap secondary line from synced invoice limit-currency totals
 * ({@link CustomerPolicy.capacity_gap_amount1}), not live FX or AR bucket ratio.
 */
export declare function resolveStoredCapacityGapSecondary(rows: PolicyRowForStoredGapSecondary[], currency: string, options?: {
    policyId?: number;
}): number | null;
