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
export function resolveCustomerCreditInsuranceSecondaryCurrency(
    customer: CustomerInvoiceCurrencyBuckets,
    accountCurrency: string | null | undefined
): string | null {
    const acct = (
        accountCurrency?.trim() ? String(accountCurrency).trim().toUpperCase() : ""
    );
    if (!acct) {
        return null;
    }

    const candidates: Array<{ code: string | null | undefined; amount: number }> = [
        {
            code: customer.customer_overdue_currency1,
            amount: Number(customer.customer_overdue_amount1 ?? 0),
        },
        {
            code: customer.customer_overdue_currency2,
            amount: Number(customer.customer_overdue_amount2 ?? 0),
        },
        {
            code: customer.customer_due_currency1,
            amount: Number(customer.customer_due_amount1 ?? 0),
        },
        {
            code: customer.customer_due_currency2,
            amount: Number(customer.customer_due_amount2 ?? 0),
        },
    ];

    for (const { code, amount } of candidates) {
        const c = code?.trim().toUpperCase();
        if (c && c !== acct && amount > 0) {
            return c;
        }
    }
    return null;
}

/**
 * Builds Total AR in the selected secondary invoice currency from customer due/overdue
 * aggregate buckets. This intentionally avoids FX conversion for header display.
 */
export function resolveCustomerTotalArSecondaryFromInvoiceBuckets(
    customer: CustomerInvoiceCurrencyBuckets,
    secondaryCurrency: string
): number | null {
    const sec = secondaryCurrency.trim().toUpperCase();
    if (!sec) {
        return null;
    }

    const buckets: Array<{ code: string | null | undefined; amount: number }> = [
        {
            code: customer.customer_overdue_currency1,
            amount: Number(customer.customer_overdue_amount1 ?? 0),
        },
        {
            code: customer.customer_overdue_currency2,
            amount: Number(customer.customer_overdue_amount2 ?? 0),
        },
        {
            code: customer.customer_due_currency1,
            amount: Number(customer.customer_due_amount1 ?? 0),
        },
        {
            code: customer.customer_due_currency2,
            amount: Number(customer.customer_due_amount2 ?? 0),
        },
    ];

    let total = 0;
    for (const bucket of buckets) {
        const code = bucket.code?.trim().toUpperCase();
        if (code === sec && Number.isFinite(bucket.amount) && bucket.amount > 0) {
            total += bucket.amount;
        }
    }

    return total > 0 ? total : null;
}

function sumCustomerBucketsForCurrency(
    buckets: Array<{ code: string | null | undefined; amount: number }>,
    secondaryCurrency: string
): number {
    const sec = secondaryCurrency.trim().toUpperCase();
    if (!sec) {
        return 0;
    }
    let total = 0;
    for (const bucket of buckets) {
        const code = bucket.code?.trim().toUpperCase();
        if (code === sec && Number.isFinite(bucket.amount)) {
            total += Math.max(0, bucket.amount);
        }
    }
    return total;
}

/** Overdue AR in invoice currency from customer aggregate buckets (no FX). */
export function resolveCustomerOverdueSecondaryFromInvoiceBuckets(
    customer: CustomerInvoiceCurrencyBuckets,
    secondaryCurrency: string
): number {
    return sumCustomerBucketsForCurrency(
        [
            {
                code: customer.customer_overdue_currency1,
                amount: Number(customer.customer_overdue_amount1 ?? 0),
            },
            {
                code: customer.customer_overdue_currency2,
                amount: Number(customer.customer_overdue_amount2 ?? 0),
            },
        ],
        secondaryCurrency
    );
}

/** Due AR in invoice currency from customer aggregate buckets (no FX). */
export function resolveCustomerDueSecondaryFromInvoiceBuckets(
    customer: CustomerInvoiceCurrencyBuckets,
    secondaryCurrency: string
): number {
    return sumCustomerBucketsForCurrency(
        [
            {
                code: customer.customer_due_currency1,
                amount: Number(customer.customer_due_amount1 ?? 0),
            },
            {
                code: customer.customer_due_currency2,
                amount: Number(customer.customer_due_amount2 ?? 0),
            },
        ],
        secondaryCurrency
    );
}

/**
 * Dual-currency display: scale a primary (account-currency) amount by the invoice
 * bucket ratio `totalArSecondary / totalArPrimary`. No live FX conversion.
 */
export function deriveSecondaryAmountFromInvoiceBucketRatio(
    primaryAmount: number,
    totalArPrimary: number,
    totalArSecondary: number | null | undefined
): number | null {
    if (
        !Number.isFinite(primaryAmount) ||
        primaryAmount <= 0 ||
        !Number.isFinite(totalArPrimary) ||
        totalArPrimary <= 0 ||
        totalArSecondary == null ||
        !Number.isFinite(totalArSecondary) ||
        totalArSecondary <= 0
    ) {
        return null;
    }
    return primaryAmount * (totalArSecondary / totalArPrimary);
}

export type CustomerWithDenormalizedAr = CustomerInvoiceCurrencyBuckets & {
    total_ar?: number | null;
};

/**
 * AR pair for dual-currency display ratios (matches Total AR header card).
 * Uses denormalized `total_ar` + invoice due/overdue buckets — not live FX or
 * per-invoice currency sums from open receivable queries.
 */
export function resolveInvoiceBucketRatioArPair(
    customer: CustomerWithDenormalizedAr,
    secondaryCurrency: string,
    fallbackArPrimary: number
): { arPrimary: number; arSecondary: number | null } {
    const arPrimary =
        customer.total_ar != null && Number(customer.total_ar) > 0
            ? Number(customer.total_ar)
            : fallbackArPrimary;
    const arSecondary = resolveCustomerTotalArSecondaryFromInvoiceBuckets(
        customer,
        secondaryCurrency
    );
    return { arPrimary, arSecondary };
}

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
export function resolveCapacityGapDisplayAmounts(
    customer: CustomerCapacityGapDisplaySource,
    kpiGapPrimary?: number | null,
    options?: {
        /** @deprecated KPI primary is preferred whenever provided. */
        preferKpiPrimary?: boolean;
        kpiGapSecondary?: number | null;
        kpiSecondaryCurrency?: string | null;
    }
): {
    primary: number;
    secondary: number | null;
    secondaryCurrency: string | null;
} {
    const fromCustomer = Number(customer.capacity_gap_amount ?? 0);
    const fromKpi =
        kpiGapPrimary != null && Number.isFinite(Number(kpiGapPrimary))
            ? Number(kpiGapPrimary)
            : null;
    const hasStored =
        customer.capacity_gap_amount != null &&
        Number.isFinite(Number(customer.capacity_gap_amount));
    const primary = Math.max(
        0,
        fromKpi != null ? fromKpi : hasStored ? fromCustomer : 0
    );
    const secondaryCurrency =
        options?.kpiSecondaryCurrency?.trim() ||
        customer.credit_insurance_secondary_currency?.trim() ||
        null;
    if (!secondaryCurrency || primary <= 0) {
        return { primary, secondary: null, secondaryCurrency };
    }
    const kpiSecondary =
        options?.kpiGapSecondary != null &&
        Number.isFinite(Number(options.kpiGapSecondary))
            ? Math.max(0, Number(options.kpiGapSecondary))
            : null;
    if (kpiSecondary != null) {
        return { primary, secondary: kpiSecondary, secondaryCurrency };
    }
    const storedSecondary =
        customer.capacity_gap_secondary != null &&
        Number.isFinite(Number(customer.capacity_gap_secondary))
            ? Math.max(0, Number(customer.capacity_gap_secondary))
            : null;
    if (storedSecondary != null) {
        return { primary, secondary: storedSecondary, secondaryCurrency };
    }
    const { arPrimary, arSecondary } = resolveInvoiceBucketRatioArPair(
        customer,
        secondaryCurrency,
        primary
    );
    const secondary = deriveSecondaryAmountFromInvoiceBucketRatio(
        primary,
        arPrimary,
        arSecondary
    );
    return { primary, secondary, secondaryCurrency };
}
