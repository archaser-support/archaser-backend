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
export declare function resolveCustomerCreditInsuranceSecondaryCurrency(customer: CustomerInvoiceCurrencyBuckets, accountCurrency: string | null | undefined): string | null;
export declare function resolveCustomerTotalArSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number | null;
export declare function resolveCustomerOverdueSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number;
export declare function resolveCustomerDueSecondaryFromInvoiceBuckets(customer: CustomerInvoiceCurrencyBuckets, secondaryCurrency: string): number;
export declare function deriveSecondaryAmountFromInvoiceBucketRatio(primaryAmount: number, totalArPrimary: number, totalArSecondary: number | null | undefined): number | null;
export type CustomerWithDenormalizedAr = CustomerInvoiceCurrencyBuckets & {
    total_ar?: number | null;
};
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
export declare function resolveCapacityGapDisplayAmounts(customer: CustomerCapacityGapDisplaySource, kpiGapPrimary?: number | null, options?: {
    preferKpiPrimary?: boolean;
    kpiGapSecondary?: number | null;
    kpiSecondaryCurrency?: string | null;
}): {
    primary: number;
    secondary: number | null;
    secondaryCurrency: string | null;
};
