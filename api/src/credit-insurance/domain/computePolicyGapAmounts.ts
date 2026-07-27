/**
 * AR-bucket gap computation for uninsured fields and legacy callers.
 * Capacity gap **writes** use invoice SUM aggregation via
 * {@link syncCustomerPolicyGapAmountsForCustomer} — not this module's gap buckets.
 */

import { Prisma } from "@prisma/client";

import type { OpenReceivableCurrencyBucket } from "./openReceivableByCustomerCurrency";

export type PolicyGapWritePayload = {
    capacity_gap_amount: number | null;
    capacity_gap_amount_date: Date | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};

export type ComputePolicyGapInput = {
    outdatedDcl: boolean;
    approvedLimit: Prisma.Decimal | null;
    approvedLimitCurrency: string | null;
    accountCurrency: string | null;
    openAr: number;
    currencyBuckets: OpenReceivableCurrencyBucket[];
    rateDate: Date;
    currencyRate?: {
        base_currency: string;
        other_currency: string;
        currency_ratio: number;
        rate_date: Date;
    } | null;
};

export type ComputePolicyGapResult =
    | { missingRate: true; payload: null }
    | { missingRate: false; payload: PolicyGapWritePayload };

function normalizeCurrency(code: string | null | undefined): string | null {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}

function zeroGapPayload(rateDate: Date): PolicyGapWritePayload {
    return {
        capacity_gap_amount: 0,
        capacity_gap_amount_date: rateDate,
        uninsured_amount: 0,
        capacity_gap_amount1: 0,
        capacity_gap_currency1: null,
        capacity_gap_amount2: 0,
        capacity_gap_currency2: null,
        uninsured_amount1: 0,
        uninsured_currency1: null,
        uninsured_amount2: 0,
        uninsured_currency2: null,
    };
}

function nullGapPayload(): PolicyGapWritePayload {
    return {
        capacity_gap_amount: null,
        capacity_gap_amount_date: null,
        uninsured_amount: null,
        capacity_gap_amount1: null,
        capacity_gap_currency1: null,
        capacity_gap_amount2: null,
        capacity_gap_currency2: null,
        uninsured_amount1: null,
        uninsured_currency1: null,
        uninsured_amount2: null,
        uninsured_currency2: null,
    };
}

function bucketGapAndUninsured(
    bucketOpenAr: number,
    approvedLimit: number
): { gap: number; uninsured: number } {
    const uninsured = bucketOpenAr - approvedLimit;
    const gap = uninsured > 0 ? uninsured : 0;
    return { gap, uninsured };
}

function applyTopBuckets(
    buckets: OpenReceivableCurrencyBucket[],
    approvedLimitCurrency: string | null,
    approvedLimitNumber: number
): Pick<
    PolicyGapWritePayload,
    | "capacity_gap_amount1"
    | "capacity_gap_currency1"
    | "capacity_gap_amount2"
    | "capacity_gap_currency2"
    | "uninsured_amount1"
    | "uninsured_currency1"
    | "uninsured_amount2"
    | "uninsured_currency2"
> {
    const result = {
        capacity_gap_amount1: 0 as number | null,
        capacity_gap_currency1: null as string | null,
        capacity_gap_amount2: 0 as number | null,
        capacity_gap_currency2: null as string | null,
        uninsured_amount1: 0 as number | null,
        uninsured_currency1: null as string | null,
        uninsured_amount2: 0 as number | null,
        uninsured_currency2: null as string | null,
    };

    if (!approvedLimitCurrency) {
        return result;
    }

    buckets.forEach((bucket, index) => {
        if (bucket.currency !== approvedLimitCurrency) {
            return;
        }
        const { gap, uninsured } = bucketGapAndUninsured(
            bucket.openAr,
            approvedLimitNumber
        );
        if (index === 0) {
            result.capacity_gap_amount1 = gap;
            result.capacity_gap_currency1 = bucket.currency;
            result.uninsured_amount1 = uninsured;
            result.uninsured_currency1 = bucket.currency;
        } else if (index === 1) {
            result.capacity_gap_amount2 = gap;
            result.capacity_gap_currency2 = bucket.currency;
            result.uninsured_amount2 = uninsured;
            result.uninsured_currency2 = bucket.currency;
        }
    });

    return result;
}

/**
 * Single writer-side gap computation (account + top-2 currency buckets).
 * Stored values are uncapped at total AR; apply min(gap, total_ar) at read time.
 */
export function computePolicyGapAmounts(
    input: ComputePolicyGapInput
): ComputePolicyGapResult {
    const rateDate = input.rateDate;

    if (input.outdatedDcl) {
        return { missingRate: false, payload: zeroGapPayload(rateDate) };
    }

    if (input.approvedLimit == null) {
        return { missingRate: false, payload: zeroGapPayload(rateDate) };
    }

    const approvedLimitNumber =
        input.approvedLimit instanceof Prisma.Decimal
            ? input.approvedLimit.toNumber()
            : new Prisma.Decimal(String(input.approvedLimit)).toNumber();
    const approvedLimitCurrency = normalizeCurrency(input.approvedLimitCurrency);
    const accountCurrency = normalizeCurrency(input.accountCurrency);
    const openAr = Math.max(0, input.openAr);

    const bucketFields = applyTopBuckets(
        input.currencyBuckets,
        approvedLimitCurrency,
        approvedLimitNumber
    );

    if (!approvedLimitCurrency || !accountCurrency) {
        const { gap, uninsured } = bucketGapAndUninsured(
            openAr,
            approvedLimitNumber
        );
        return {
            missingRate: false,
            payload: {
                capacity_gap_amount: gap,
                capacity_gap_amount_date: rateDate,
                uninsured_amount: uninsured,
                ...bucketFields,
            },
        };
    }

    if (approvedLimitCurrency === accountCurrency) {
        const { gap, uninsured } = bucketGapAndUninsured(
            openAr,
            approvedLimitNumber
        );
        return {
            missingRate: false,
            payload: {
                capacity_gap_amount: gap,
                capacity_gap_amount_date: rateDate,
                uninsured_amount: uninsured,
                ...bucketFields,
            },
        };
    }

    const rate = input.currencyRate;
    if (
        !rate ||
        !Number.isFinite(rate.currency_ratio) ||
        rate.currency_ratio === 0
    ) {
        return { missingRate: true, payload: null };
    }

    let approvedLimitInAccountCurrency: number;
    if (
        rate.base_currency === accountCurrency &&
        rate.other_currency === approvedLimitCurrency
    ) {
        approvedLimitInAccountCurrency =
            approvedLimitNumber / rate.currency_ratio;
    } else if (
        rate.base_currency === approvedLimitCurrency &&
        rate.other_currency === accountCurrency
    ) {
        approvedLimitInAccountCurrency =
            approvedLimitNumber * rate.currency_ratio;
    } else {
        return { missingRate: true, payload: null };
    }

    let gap: number;
    let uninsured: number;

    const gapInPolicyCurrency = bucketFields.capacity_gap_amount1;
    const uninsuredInPolicyCurrency = bucketFields.uninsured_amount1;

    if (
        bucketFields.capacity_gap_currency1 === approvedLimitCurrency &&
        gapInPolicyCurrency != null &&
        uninsuredInPolicyCurrency != null
    ) {
        // Convert policy currency gap and uninsured to account base currency using latest rate
        if (
            rate.base_currency === accountCurrency &&
            rate.other_currency === approvedLimitCurrency
        ) {
            gap = gapInPolicyCurrency / rate.currency_ratio;
            uninsured = uninsuredInPolicyCurrency / rate.currency_ratio;
        } else if (
            rate.base_currency === approvedLimitCurrency &&
            rate.other_currency === accountCurrency
        ) {
            gap = gapInPolicyCurrency * rate.currency_ratio;
            uninsured = uninsuredInPolicyCurrency * rate.currency_ratio;
        } else {
            return { missingRate: true, payload: null };
        }
    } else {
        // Fallback to traditional subtraction of base-currency limit from base-currency AR
        uninsured = openAr - approvedLimitInAccountCurrency;
        gap = uninsured > 0 ? uninsured : 0;
    }

    return {
        missingRate: false,
        payload: {
            capacity_gap_amount: gap,
            capacity_gap_amount_date: rate.rate_date,
            uninsured_amount: uninsured,
            ...bucketFields,
        },
    };
}

export { nullGapPayload };
