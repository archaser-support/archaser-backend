export type CustomerInvoiceCurrencyBuckets = {
    customer_overdue_currency1?: string | null;
    customer_overdue_currency2?: string | null;
    customer_due_currency1?: string | null;
    customer_due_currency2?: string | null;
    customer_overdue_amount1?: number | null;
    customer_overdue_amount2?: number | null;
    customer_due_amount1?: number | null;
    customer_due_amount2?: number | null;
};
/**
 * When overdue/due breakdown uses a second currency (e.g. GBP) alongside account
 * currency (e.g. ILS), reuse that code for credit-insurance header FX so the Total
 * AR card matches the "Total Overdue Amount" dual-currency pattern.
 */
export declare function resolveCustomerCreditInsuranceSecondaryCurrency(customer: CustomerInvoiceCurrencyBuckets, accountCurrency: string | null | undefined): string | null;
/**
 * Builds Total AR in the selected secondary invoice currency from customer due/overdue
 * aggregate buckets. This intentionally avoids FX conversion for header display.
 */
export declare function resolveCustomerTotalArSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number | null;
/** Overdue AR in invoice currency from customer aggregate buckets (no FX). */
export declare function resolveCustomerOverdueSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number;
/** Due AR in invoice currency from customer aggregate buckets (no FX). */
export declare function resolveCustomerDueSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number;
/**
 * Dual-currency display: scale a primary (account-currency) amount by the invoice
 * bucket ratio `totalArSecondary / totalArPrimary`. No live FX conversion.
 */
export declare function deriveSecondaryAmountFromInvoiceBucketRatio(primaryAmount: number, totalArPrimary: number, totalArSecondary: number | null | undefined): number | null;
export type CustomerWithDenormalizedAr = CustomerInvoiceCurrencyBuckets & {
    total_ar?: number | null;
};
/**
 * AR pair for dual-currency display ratios (matches Total AR header card).
 * Uses denormalized `total_ar` + invoice due/overdue buckets — not live FX or
 * per-invoice currency sums from open receivable queries.
 */
export declare function resolveInvoiceBucketRatioArPair(customer: CustomerWithDenormalizedAr, secondaryCurrency: string, fallbackArPrimary: number): {
    arPrimary: number;
    arSecondary: number | null;
};
export type CustomerCapacityGapDisplaySource = CustomerWithDenormalizedAr & {
    capacity_gap_amount?: number | null;
    capacity_gap_secondary?: number | null;
    credit_insurance_secondary_currency?: string | null;
    total_ar_secondary?: number | null;
};
/**
 * Capacity gap dual-currency line aligned with the customer header Total AR card.
 * When {@link kpiGapPrimary} is provided (dashboard KPI query, runs gap sync), it wins over
 * the customer GET payload, which may be stale in the client cache. Customer entity values
 * are used only before KPI loads.
 */
export declare function resolveCapacityGapDisplayAmounts(customer: CustomerCapacityGapDisplaySource, kpiGapPrimary?: number | null, options?: {
    /** @deprecated KPI primary is preferred whenever provided. */
    preferKpiPrimary?: boolean;
    kpiGapSecondary?: number | null;
    kpiSecondaryCurrency?: string | null;
}): {
    primary: number;
    secondary: number | null;
    secondaryCurrency: string | null;
};
