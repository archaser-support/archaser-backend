"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActiveTopUp = isActiveTopUp;
exports.resolveTopUpMonetaryAmount = resolveTopUpMonetaryAmount;
exports.resolveEffectiveApprovedLimit = resolveEffectiveApprovedLimit;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function isActiveTopUp(row, asOfDate) {
    if (row.cancelled_at) {
        return false;
    }
    const asOf = startOfUtcDay(asOfDate);
    const start = startOfUtcDay(row.start_date);
    const end = startOfUtcDay(row.end_date);
    return asOf >= start && asOf <= end;
}
function resolveTopUpMonetaryAmount(row, baseApprovedLimit) {
    if (baseApprovedLimit == null || new client_1.Prisma.Decimal(baseApprovedLimit).lte(0)) {
        return 0;
    }
    const value = new client_1.Prisma.Decimal(row.top_up_value);
    if (row.top_up_type === "Percentage") {
        return new client_1.Prisma.Decimal(baseApprovedLimit).mul(value.div(100)).toNumber();
    }
    return value.toNumber();
}
async function fetchCurrencyRate(fromCurrency, toCurrency) {
    const rate = await domain_db_1.prisma.currencyRate.findFirst({
        where: {
            OR: [
                { base_currency: toCurrency, other_currency: fromCurrency },
                { base_currency: fromCurrency, other_currency: toCurrency },
            ],
        },
        orderBy: { rate_date: "desc" },
        select: { base_currency: true, other_currency: true, currency_ratio: true },
    });
    return rate ?? null;
}
function convertAmount(amount, fromCurrency, toCurrency, rate) {
    if (fromCurrency === toCurrency) {
        return { converted: amount, missingRate: false };
    }
    if (!rate) {
        return { converted: amount, missingRate: true };
    }
    if (rate.base_currency === toCurrency && rate.other_currency === fromCurrency) {
        return { converted: amount / rate.currency_ratio, missingRate: false };
    }
    return { converted: amount * rate.currency_ratio, missingRate: false };
}
async function resolveEffectiveApprovedLimit(customerId, options) {
    const asOfDate = options?.asOfDate ?? new Date();
    const asOfUtcDay = startOfUtcDay(asOfDate);
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
    const baseLimit = options?.baseApprovedLimit ?? null;
    const baseCurrency = options?.baseApprovedLimitCurrency ?? null;
    const outdatedDcl = options?.outdatedDcl ?? false;
    const excludedFromPolicy = options?.excludedFromPolicy ?? false;
    if (outdatedDcl || excludedFromPolicy || baseLimit == null) {
        return {
            baseApprovedLimit: baseLimit,
            baseApprovedLimitCurrency: baseCurrency,
            topUpByPolicy: [],
            topUpTotalInLimitCurrency: 0,
            effectiveApprovedLimit: baseLimit != null ? new client_1.Prisma.Decimal(baseLimit).toNumber() : null,
            limitCurrency: baseCurrency,
            missingRate: false,
        };
    }
    const activeTopUps = await dbClient.customerTopUp.findMany({
        where: {
            customer_id: customerId,
            cancelled_at: null,
            start_date: { lte: asOfUtcDay },
            end_date: { gte: asOfUtcDay },
            InsurancePolicy: {
                policy_kind: "TopUp",
            },
        },
        select: {
            id: true,
            top_up_type: true,
            top_up_value: true,
            currency: true,
            start_date: true,
            end_date: true,
            cancelled_at: true,
            InsurancePolicy: {
                select: {
                    id: true,
                    allow_concurrent_top_ups: true,
                    parent_insurance_policy_id: true,
                },
            },
        },
    });
    if (activeTopUps.length === 0) {
        return {
            baseApprovedLimit: baseLimit,
            baseApprovedLimitCurrency: baseCurrency,
            topUpByPolicy: [],
            topUpTotalInLimitCurrency: 0,
            effectiveApprovedLimit: new client_1.Prisma.Decimal(baseLimit).toNumber(),
            limitCurrency: baseCurrency,
            missingRate: false,
        };
    }
    const byPolicy = new Map();
    for (const row of activeTopUps) {
        if (!isActiveTopUp(row, asOfDate)) {
            continue;
        }
        const parentId = row.InsurancePolicy.parent_insurance_policy_id;
        if (options?.parentPrimaryPolicyId != null) {
            if (parentId !== options.parentPrimaryPolicyId) {
                continue;
            }
        }
        const policyId = row.InsurancePolicy.id;
        let bucket = byPolicy.get(policyId);
        if (!bucket) {
            bucket = {
                id: policyId,
                allow_concurrent_top_ups: row.InsurancePolicy.allow_concurrent_top_ups,
                parent_insurance_policy_id: row.InsurancePolicy.parent_insurance_policy_id,
                rows: [],
            };
            byPolicy.set(policyId, bucket);
        }
        bucket.rows.push(row);
    }
    let topUpTotalInLimitCurrency = 0;
    let missingRate = false;
    const topUpByPolicy = [];
    for (const [, bucket] of Array.from(byPolicy)) {
        const resolvedRows = [];
        let policySubtotal = 0;
        for (const row of bucket.rows) {
            const resolvedAmount = resolveTopUpMonetaryAmount(row, baseLimit);
            if (resolvedAmount <= 0) {
                continue;
            }
            resolvedRows.push({
                id: row.id,
                topUpType: row.top_up_type,
                topUpValue: row.top_up_value,
                resolvedMonetaryAmount: resolvedAmount,
                currency: row.currency,
                startDate: row.start_date,
                endDate: row.end_date,
            });
            policySubtotal += resolvedAmount;
        }
        const rowCurrency = bucket.rows[0]?.currency || baseCurrency;
        const { converted, missingRate: mr } = convertAmount(policySubtotal, rowCurrency ?? baseCurrency ?? "USD", baseCurrency ?? "USD", rowCurrency && baseCurrency && rowCurrency !== baseCurrency
            ? await fetchCurrencyRate(rowCurrency, baseCurrency)
            : null);
        if (mr) {
            missingRate = true;
        }
        topUpTotalInLimitCurrency += converted;
        topUpByPolicy.push({
            insurancePolicyId: bucket.id,
            allowConcurrent: bucket.allow_concurrent_top_ups,
            parentPrimaryPolicyId: bucket.parent_insurance_policy_id,
            rows: resolvedRows,
            policySubtotal: converted,
        });
    }
    const effectiveLimitNum = new client_1.Prisma.Decimal(baseLimit).toNumber() + topUpTotalInLimitCurrency;
    return {
        baseApprovedLimit: baseLimit,
        baseApprovedLimitCurrency: baseCurrency,
        topUpByPolicy,
        topUpTotalInLimitCurrency,
        effectiveApprovedLimit: effectiveLimitNum,
        limitCurrency: baseCurrency,
        missingRate,
    };
}
//# sourceMappingURL=resolveEffectiveApprovedLimit.js.map