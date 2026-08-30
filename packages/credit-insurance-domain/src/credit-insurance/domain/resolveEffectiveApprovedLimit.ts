import { Prisma } from "@prisma/client";

import { prisma, type DbClient } from "../domain-db";

export type TopUpRowForResolution = {
    id: number;
    top_up_type: "Fixed" | "Percentage";
    top_up_value: Prisma.Decimal;
    currency: string | null;
    start_date: Date;
    end_date: Date;
    cancelled_at: Date | null;
    InsurancePolicy: {
        id: number;
        allow_concurrent_top_ups: boolean;
        parent_insurance_policy_id: number | null;
    };
};

export type ResolvedTopUpByPolicy = {
    insurancePolicyId: number;
    allowConcurrent: boolean;
    parentPrimaryPolicyId: number | null;
    rows: Array<{
        id: number;
        topUpType: "Fixed" | "Percentage";
        topUpValue: Prisma.Decimal;
        resolvedMonetaryAmount: number;
        currency: string | null;
        startDate: Date;
        endDate: Date;
    }>;
    policySubtotal: number;
};

export type EffectiveApprovedLimitResult = {
    baseApprovedLimit: Prisma.Decimal | null;
    baseApprovedLimitCurrency: string | null;
    topUpByPolicy: ResolvedTopUpByPolicy[];
    topUpTotalInLimitCurrency: number;
    effectiveApprovedLimit: number | null;
    limitCurrency: string | null;
    missingRate: boolean;
};

function startOfUtcDay(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function isActiveTopUp(row: {
    start_date: Date;
    end_date: Date;
    cancelled_at: Date | null;
}, asOfDate: Date): boolean {
    if (row.cancelled_at) {
        return false;
    }
    const asOf = startOfUtcDay(asOfDate);
    const start = startOfUtcDay(row.start_date);
    const end = startOfUtcDay(row.end_date);
    return asOf >= start && asOf <= end;
}

export function resolveTopUpMonetaryAmount(
    row: { top_up_type: string; top_up_value: Prisma.Decimal },
    baseApprovedLimit: Prisma.Decimal | null | undefined,
): number {
    if (baseApprovedLimit == null || new Prisma.Decimal(baseApprovedLimit).lte(0)) {
        return 0;
    }
    const value = new Prisma.Decimal(row.top_up_value);
    if (row.top_up_type === "Percentage") {
        return new Prisma.Decimal(baseApprovedLimit).mul(value.div(100)).toNumber();
    }
    return value.toNumber();
}

async function fetchCurrencyRate(
    fromCurrency: string,
    toCurrency: string,
): Promise<{ currency_ratio: number; base_currency: string; other_currency: string } | null> {
    const rate = await prisma.currencyRate.findFirst({
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

function convertAmount(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    rate: { base_currency: string; other_currency: string; currency_ratio: number } | null,
): { converted: number; missingRate: boolean } {
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

export async function resolveEffectiveApprovedLimit(
    customerId: number,
    options?: {
        asOfDate?: Date;
        baseApprovedLimit?: Prisma.Decimal | null;
        baseApprovedLimitCurrency?: string | null;
        outdatedDcl?: boolean;
        excludedFromPolicy?: boolean;
        /** When set, only top-ups linked to this primary policy count (D10). */
        parentPrimaryPolicyId?: number;
        dbClient?: DbClient;
    },
): Promise<EffectiveApprovedLimitResult> {
    const asOfDate = options?.asOfDate ?? new Date();
    const asOfUtcDay = startOfUtcDay(asOfDate);
    const dbClient = options?.dbClient ?? prisma;

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
            effectiveApprovedLimit: baseLimit != null ? new Prisma.Decimal(baseLimit).toNumber() : null,
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
            effectiveApprovedLimit: new Prisma.Decimal(baseLimit).toNumber(),
            limitCurrency: baseCurrency,
            missingRate: false,
        };
    }

    const byPolicy = new Map<number, TopUpRowForResolution["InsurancePolicy"] & { rows: TopUpRowForResolution[] }>();

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
        bucket.rows.push(row as TopUpRowForResolution);
    }

    let topUpTotalInLimitCurrency = 0;
    let missingRate = false;
    const topUpByPolicy: ResolvedTopUpByPolicy[] = [];

    for (const [, bucket] of Array.from(byPolicy)) {
        const resolvedRows: ResolvedTopUpByPolicy["rows"] = [];
        let policySubtotal = 0;

        for (const row of bucket.rows) {
            const resolvedAmount = resolveTopUpMonetaryAmount(row, baseLimit);
            if (resolvedAmount <= 0) {
                continue;
            }
            resolvedRows.push({
                id: row.id,
                topUpType: row.top_up_type as "Fixed" | "Percentage",
                topUpValue: row.top_up_value,
                resolvedMonetaryAmount: resolvedAmount,
                currency: row.currency,
                startDate: row.start_date,
                endDate: row.end_date,
            });
            policySubtotal += resolvedAmount;
        }

        const rowCurrency = bucket.rows[0]?.currency || baseCurrency;
        const { converted, missingRate: mr } = convertAmount(
            policySubtotal,
            rowCurrency ?? baseCurrency ?? "USD",
            baseCurrency ?? "USD",
            rowCurrency && baseCurrency && rowCurrency !== baseCurrency
                ? await fetchCurrencyRate(rowCurrency, baseCurrency)
                : null,
        );
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

    const effectiveLimitNum = new Prisma.Decimal(baseLimit).toNumber() + topUpTotalInLimitCurrency;

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
