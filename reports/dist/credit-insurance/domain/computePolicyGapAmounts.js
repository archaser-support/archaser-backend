"use strict";
/**
 * AR-bucket gap computation for uninsured fields and legacy callers.
 * Capacity gap **writes** use invoice SUM aggregation via
 * {@link syncCustomerPolicyGapAmountsForCustomer} — not this module's gap buckets.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePolicyGapAmounts = computePolicyGapAmounts;
exports.nullGapPayload = nullGapPayload;
const client_1 = require("@prisma/client");
function normalizeCurrency(code) {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}
function zeroGapPayload(rateDate) {
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
function nullGapPayload() {
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
function bucketGapAndUninsured(bucketOpenAr, approvedLimit) {
    const uninsured = bucketOpenAr - approvedLimit;
    const gap = uninsured > 0 ? uninsured : 0;
    return { gap, uninsured };
}
function applyTopBuckets(buckets, approvedLimitCurrency, approvedLimitNumber) {
    const result = {
        capacity_gap_amount1: 0,
        capacity_gap_currency1: null,
        capacity_gap_amount2: 0,
        capacity_gap_currency2: null,
        uninsured_amount1: 0,
        uninsured_currency1: null,
        uninsured_amount2: 0,
        uninsured_currency2: null,
    };
    if (!approvedLimitCurrency) {
        return result;
    }
    buckets.forEach((bucket, index) => {
        if (bucket.currency !== approvedLimitCurrency) {
            return;
        }
        const { gap, uninsured } = bucketGapAndUninsured(bucket.openAr, approvedLimitNumber);
        if (index === 0) {
            result.capacity_gap_amount1 = gap;
            result.capacity_gap_currency1 = bucket.currency;
            result.uninsured_amount1 = uninsured;
            result.uninsured_currency1 = bucket.currency;
        }
        else if (index === 1) {
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
function computePolicyGapAmounts(input) {
    const rateDate = input.rateDate;
    if (input.outdatedDcl) {
        return { missingRate: false, payload: zeroGapPayload(rateDate) };
    }
    if (input.approvedLimit == null) {
        return { missingRate: false, payload: zeroGapPayload(rateDate) };
    }
    const approvedLimitNumber = input.approvedLimit instanceof client_1.Prisma.Decimal
        ? input.approvedLimit.toNumber()
        : new client_1.Prisma.Decimal(String(input.approvedLimit)).toNumber();
    const approvedLimitCurrency = normalizeCurrency(input.approvedLimitCurrency);
    const accountCurrency = normalizeCurrency(input.accountCurrency);
    const openAr = Math.max(0, input.openAr);
    const bucketFields = applyTopBuckets(input.currencyBuckets, approvedLimitCurrency, approvedLimitNumber);
    if (!approvedLimitCurrency || !accountCurrency) {
        const { gap, uninsured } = bucketGapAndUninsured(openAr, approvedLimitNumber);
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
        const { gap, uninsured } = bucketGapAndUninsured(openAr, approvedLimitNumber);
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
    if (!rate ||
        !Number.isFinite(rate.currency_ratio) ||
        rate.currency_ratio === 0) {
        return { missingRate: true, payload: null };
    }
    let approvedLimitInAccountCurrency;
    if (rate.base_currency === accountCurrency &&
        rate.other_currency === approvedLimitCurrency) {
        approvedLimitInAccountCurrency =
            approvedLimitNumber / rate.currency_ratio;
    }
    else if (rate.base_currency === approvedLimitCurrency &&
        rate.other_currency === accountCurrency) {
        approvedLimitInAccountCurrency =
            approvedLimitNumber * rate.currency_ratio;
    }
    else {
        return { missingRate: true, payload: null };
    }
    let gap;
    let uninsured;
    const gapInPolicyCurrency = bucketFields.capacity_gap_amount1;
    const uninsuredInPolicyCurrency = bucketFields.uninsured_amount1;
    if (bucketFields.capacity_gap_currency1 === approvedLimitCurrency &&
        gapInPolicyCurrency != null &&
        uninsuredInPolicyCurrency != null) {
        // Convert policy currency gap and uninsured to account base currency using latest rate
        if (rate.base_currency === accountCurrency &&
            rate.other_currency === approvedLimitCurrency) {
            gap = gapInPolicyCurrency / rate.currency_ratio;
            uninsured = uninsuredInPolicyCurrency / rate.currency_ratio;
        }
        else if (rate.base_currency === approvedLimitCurrency &&
            rate.other_currency === accountCurrency) {
            gap = gapInPolicyCurrency * rate.currency_ratio;
            uninsured = uninsuredInPolicyCurrency * rate.currency_ratio;
        }
        else {
            return { missingRate: true, payload: null };
        }
    }
    else {
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
