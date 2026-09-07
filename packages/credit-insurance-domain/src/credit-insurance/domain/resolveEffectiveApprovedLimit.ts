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

type ResolveTopUpOptions = {
    baseApprovedLimit?: Prisma.Decimal | null;
    baseApprovedLimitCurrency?: string | null;
    outdatedDcl?: boolean;
    excludedFromPolicy?: boolean;
    /** When set, only top-ups linked to this primary policy count (D10). */
    parentPrimaryPolicyId?: number;
    dbClient?: DbClient;
};

const TOP_UP_SELECT = {
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
} as const;

async function resolveTopUpsFromRows(
    rows: TopUpRowForResolution[],
    asOfDate: Date,
    baseLimit: Prisma.Decimal,
    baseCurrency: string | null,
    parentPrimaryPolicyId: number | undefined,
    rateCache: Map<
        string,
        { currency_ratio: number; base_currency: string; other_currency: string } | null
    >
): Promise<{
    topUpByPolicy: ResolvedTopUpByPolicy[];
    topUpTotalInLimitCurrency: number;
    missingRate: boolean;
}> {
    const byPolicy = new Map<
        number,
        TopUpRowForResolution["InsurancePolicy"] & { rows: TopUpRowForResolution[] }
    >();

    for (const row of rows) {
        if (!isActiveTopUp(row, asOfDate)) {
            continue;
        }
        const parentId = row.InsurancePolicy.parent_insurance_policy_id;
        if (parentPrimaryPolicyId != null && parentId !== parentPrimaryPolicyId) {
            continue;
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
        const from = rowCurrency ?? baseCurrency ?? "USD";
        const to = baseCurrency ?? "USD";
        let rate: {
            currency_ratio: number;
            base_currency: string;
            other_currency: string;
        } | null = null;
        if (rowCurrency && baseCurrency && rowCurrency !== baseCurrency) {
            const cacheKey = `${from}->${to}`;
            if (rateCache.has(cacheKey)) {
                rate = rateCache.get(cacheKey) ?? null;
            } else {
                rate = await fetchCurrencyRate(from, to);
                rateCache.set(cacheKey, rate);
            }
        }
        const { converted, missingRate: mr } = convertAmount(
            policySubtotal,
            from,
            to,
            rate
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

    return { topUpByPolicy, topUpTotalInLimitCurrency, missingRate };
}

function emptyEffectiveLimitResult(args: {
    baseLimit: Prisma.Decimal | null;
    baseCurrency: string | null;
}): EffectiveApprovedLimitResult {
    const baseNumeric =
        args.baseLimit != null ? new Prisma.Decimal(args.baseLimit).toNumber() : null;
    return {
        baseApprovedLimit: args.baseLimit,
        baseApprovedLimitCurrency: args.baseCurrency,
        topUpByPolicy: [],
        topUpTotalInLimitCurrency: 0,
        effectiveApprovedLimit: baseNumeric,
        limitCurrency: args.baseCurrency,
        missingRate: false,
    };
}

/** Resolve effective limit from preloaded top-up rows (no extra DB round-trip). */
export async function resolveEffectiveApprovedLimitFromTopUpRows(
    activeTopUps: TopUpRowForResolution[],
    options?: ResolveTopUpOptions & { asOfDate?: Date }
): Promise<EffectiveApprovedLimitResult> {
    const asOfDate = options?.asOfDate ?? new Date();
    const baseLimit = options?.baseApprovedLimit ?? null;
    const baseCurrency = options?.baseApprovedLimitCurrency ?? null;
    const outdatedDcl = options?.outdatedDcl ?? false;
    const excludedFromPolicy = options?.excludedFromPolicy ?? false;

    if (outdatedDcl || excludedFromPolicy || baseLimit == null) {
        return emptyEffectiveLimitResult({ baseLimit, baseCurrency });
    }

    if (activeTopUps.length === 0) {
        return {
            ...emptyEffectiveLimitResult({ baseLimit, baseCurrency }),
            effectiveApprovedLimit: new Prisma.Decimal(baseLimit).toNumber(),
        };
    }

    const resolved = await resolveTopUpsFromRows(
        activeTopUps,
        asOfDate,
        baseLimit,
        baseCurrency,
        options?.parentPrimaryPolicyId,
        new Map()
    );

    return {
        baseApprovedLimit: baseLimit,
        baseApprovedLimitCurrency: baseCurrency,
        topUpByPolicy: resolved.topUpByPolicy,
        topUpTotalInLimitCurrency: resolved.topUpTotalInLimitCurrency,
        effectiveApprovedLimit:
            new Prisma.Decimal(baseLimit).toNumber() +
            resolved.topUpTotalInLimitCurrency,
        limitCurrency: baseCurrency,
        missingRate: resolved.missingRate,
    };
}

export async function resolveEffectiveApprovedLimit(
    customerId: number,
    options?: ResolveTopUpOptions & { asOfDate?: Date }
): Promise<EffectiveApprovedLimitResult> {
    const asOfDate = options?.asOfDate ?? new Date();
    const asOfUtcDay = startOfUtcDay(asOfDate);
    const dbClient = options?.dbClient ?? prisma;

    const baseLimit = options?.baseApprovedLimit ?? null;
    const baseCurrency = options?.baseApprovedLimitCurrency ?? null;
    const outdatedDcl = options?.outdatedDcl ?? false;
    const excludedFromPolicy = options?.excludedFromPolicy ?? false;

    if (outdatedDcl || excludedFromPolicy || baseLimit == null) {
        return emptyEffectiveLimitResult({ baseLimit, baseCurrency });
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
        select: TOP_UP_SELECT,
    });

    return resolveEffectiveApprovedLimitFromTopUpRows(
        activeTopUps as TopUpRowForResolution[],
        options
    );
}

/**
 * Prefetch top-up totals for many as-of dates with one DB load of candidate
 * top-ups, then resolve each day in memory (shared FX-rate cache).
 */
export async function resolveTopUpTotalsForAsOfDates(
    customerId: number,
    asOfDates: Date[],
    options?: ResolveTopUpOptions
): Promise<Map<number, number>> {
    const totals = new Map<number, number>();
    if (asOfDates.length === 0) {
        return totals;
    }

    const baseLimit = options?.baseApprovedLimit ?? null;
    const baseCurrency = options?.baseApprovedLimitCurrency ?? null;
    const outdatedDcl = options?.outdatedDcl ?? false;
    const excludedFromPolicy = options?.excludedFromPolicy ?? false;
    const dbClient = options?.dbClient ?? prisma;

    const utcDays = asOfDates.map(startOfUtcDay);
    for (const day of utcDays) {
        totals.set(day.getTime(), 0);
    }

    if (outdatedDcl || excludedFromPolicy || baseLimit == null) {
        return totals;
    }

    let minDay = utcDays[0]!;
    let maxDay = utcDays[0]!;
    for (const day of utcDays) {
        if (day < minDay) minDay = day;
        if (day > maxDay) maxDay = day;
    }

    const candidateTopUps = await dbClient.customerTopUp.findMany({
        where: {
            customer_id: customerId,
            cancelled_at: null,
            start_date: { lte: maxDay },
            end_date: { gte: minDay },
            InsurancePolicy: {
                policy_kind: "TopUp",
            },
        },
        select: TOP_UP_SELECT,
    });

    if (candidateTopUps.length === 0) {
        return totals;
    }

    const rateCache = new Map<
        string,
        { currency_ratio: number; base_currency: string; other_currency: string } | null
    >();

    for (const asOfDate of asOfDates) {
        const day = startOfUtcDay(asOfDate);
        const resolved = await resolveTopUpsFromRows(
            candidateTopUps as TopUpRowForResolution[],
            asOfDate,
            baseLimit,
            baseCurrency,
            options?.parentPrimaryPolicyId,
            rateCache
        );
        totals.set(day.getTime(), resolved.topUpTotalInLimitCurrency);
    }

    return totals;
}
