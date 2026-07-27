"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomerCreditInsuranceSecondaryCurrency = resolveCustomerCreditInsuranceSecondaryCurrency;
exports.resolveCustomerTotalArSecondaryFromInvoiceBuckets = resolveCustomerTotalArSecondaryFromInvoiceBuckets;
exports.resolveCustomerOverdueSecondaryFromInvoiceBuckets = resolveCustomerOverdueSecondaryFromInvoiceBuckets;
exports.resolveCustomerDueSecondaryFromInvoiceBuckets = resolveCustomerDueSecondaryFromInvoiceBuckets;
exports.deriveSecondaryAmountFromInvoiceBucketRatio = deriveSecondaryAmountFromInvoiceBucketRatio;
exports.resolveInvoiceBucketRatioArPair = resolveInvoiceBucketRatioArPair;
exports.resolveCapacityGapDisplayAmounts = resolveCapacityGapDisplayAmounts;
function resolveCustomerCreditInsuranceSecondaryCurrency(customer, accountCurrency) {
    const acct = (accountCurrency?.trim() ? String(accountCurrency).trim().toUpperCase() : "");
    if (!acct) {
        return null;
    }
    const candidates = [
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
function resolveCustomerTotalArSecondaryFromInvoiceBuckets(customer, secondaryCurrency) {
    const sec = secondaryCurrency.trim().toUpperCase();
    if (!sec) {
        return null;
    }
    const buckets = [
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
function sumCustomerBucketsForCurrency(buckets, secondaryCurrency) {
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
function resolveCustomerOverdueSecondaryFromInvoiceBuckets(customer, secondaryCurrency) {
    return sumCustomerBucketsForCurrency([
        {
            code: customer.customer_overdue_currency1,
            amount: Number(customer.customer_overdue_amount1 ?? 0),
        },
        {
            code: customer.customer_overdue_currency2,
            amount: Number(customer.customer_overdue_amount2 ?? 0),
        },
    ], secondaryCurrency);
}
function resolveCustomerDueSecondaryFromInvoiceBuckets(customer, secondaryCurrency) {
    return sumCustomerBucketsForCurrency([
        {
            code: customer.customer_due_currency1,
            amount: Number(customer.customer_due_amount1 ?? 0),
        },
        {
            code: customer.customer_due_currency2,
            amount: Number(customer.customer_due_amount2 ?? 0),
        },
    ], secondaryCurrency);
}
function deriveSecondaryAmountFromInvoiceBucketRatio(primaryAmount, totalArPrimary, totalArSecondary) {
    if (!Number.isFinite(primaryAmount) ||
        primaryAmount <= 0 ||
        !Number.isFinite(totalArPrimary) ||
        totalArPrimary <= 0 ||
        totalArSecondary == null ||
        !Number.isFinite(totalArSecondary) ||
        totalArSecondary <= 0) {
        return null;
    }
    return primaryAmount * (totalArSecondary / totalArPrimary);
}
function resolveInvoiceBucketRatioArPair(customer, secondaryCurrency, fallbackArPrimary) {
    const arPrimary = customer.total_ar != null && Number(customer.total_ar) > 0
        ? Number(customer.total_ar)
        : fallbackArPrimary;
    const arSecondary = resolveCustomerTotalArSecondaryFromInvoiceBuckets(customer, secondaryCurrency);
    return { arPrimary, arSecondary };
}
function resolveCapacityGapDisplayAmounts(customer, kpiGapPrimary, options) {
    const fromCustomer = Number(customer.capacity_gap_amount ?? 0);
    const fromKpi = kpiGapPrimary != null && Number.isFinite(Number(kpiGapPrimary))
        ? Number(kpiGapPrimary)
        : null;
    const hasStored = customer.capacity_gap_amount != null &&
        Number.isFinite(Number(customer.capacity_gap_amount));
    const primary = Math.max(0, fromKpi != null ? fromKpi : hasStored ? fromCustomer : 0);
    const secondaryCurrency = options?.kpiSecondaryCurrency?.trim() ||
        customer.credit_insurance_secondary_currency?.trim() ||
        null;
    if (!secondaryCurrency || primary <= 0) {
        return { primary, secondary: null, secondaryCurrency };
    }
    const kpiSecondary = options?.kpiGapSecondary != null &&
        Number.isFinite(Number(options.kpiGapSecondary))
        ? Math.max(0, Number(options.kpiGapSecondary))
        : null;
    if (kpiSecondary != null) {
        return { primary, secondary: kpiSecondary, secondaryCurrency };
    }
    const storedSecondary = customer.capacity_gap_secondary != null &&
        Number.isFinite(Number(customer.capacity_gap_secondary))
        ? Math.max(0, Number(customer.capacity_gap_secondary))
        : null;
    if (storedSecondary != null) {
        return { primary, secondary: storedSecondary, secondaryCurrency };
    }
    const { arPrimary, arSecondary } = resolveInvoiceBucketRatioArPair(customer, secondaryCurrency, primary);
    const secondary = deriveSecondaryAmountFromInvoiceBucketRatio(primary, arPrimary, arSecondary);
    return { primary, secondary, secondaryCurrency };
}
//# sourceMappingURL=invoiceBucketAmounts.js.map