import type { cost_calculation_method } from "@prisma/client";

import { isActiveTopUp } from "./resolveEffectiveApprovedLimit";

export type DailyCostAmount = {
    amount: number;
    currency: string;
};

export type PolicyDailyCostInput = {
    costCalculationMethod: cost_calculation_method | null | undefined;
    costPercent: number | null | undefined;
    approvedLimit: number | null;
    usageAmount: number;
    limitCurrency: string | null;
    excludedFromPolicy: boolean;
    outdatedDcl: boolean;
};

export type TopUpForDailyCost = {
    premium: number | null;
    premiumCurrency: string | null;
    startDate: Date;
    endDate: Date;
    cancelledAt: Date | null;
};

export type PolicyDailyCostResult = {
    policyDailyCost: DailyCostAmount | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: number | null;
};

function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

export function inclusiveUtcCalendarDays(startDate: Date, endDate: Date): number {
    const start = startOfUtcDay(startDate);
    const end = startOfUtcDay(endDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}

function normalizeCurrency(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed.toUpperCase() : null;
}

function computeTopUpDailyRate(
    premium: number,
    startDate: Date,
    endDate: Date
): number {
    const inclusiveDays = inclusiveUtcCalendarDays(startDate, endDate);
    if (inclusiveDays <= 0) {
        return 0;
    }
    return premium / inclusiveDays;
}

/**
 * Primary policy daily cost from cost config, approved limit, and usage amount.
 * Cost % is a daily rate (not annual ÷ 365).
 */
export function computePolicyDailyCost(
    input: PolicyDailyCostInput
): PolicyDailyCostResult {
    const costCalculationMethod = input.costCalculationMethod ?? null;
    const costPercent =
        input.costPercent != null && Number.isFinite(input.costPercent)
            ? input.costPercent
            : null;

    if (input.excludedFromPolicy || input.outdatedDcl) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }

    if (costCalculationMethod == null || costPercent == null) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }

    const currency = normalizeCurrency(input.limitCurrency);
    if (!currency) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }

    let basisAmount: number | null = null;
    if (costCalculationMethod === "Limit") {
        basisAmount = input.approvedLimit;
    } else if (costCalculationMethod === "ActualSales") {
        basisAmount = Math.max(0, input.usageAmount);
    }

    if (basisAmount == null || basisAmount <= 0) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }

    const amount = (basisAmount * costPercent) / 100;
    return {
        policyDailyCost: { amount, currency },
        costCalculationMethod,
        costPercent,
    };
}

/**
 * Sum active top-ups' daily premium rates when premium currencies match.
 */
export function computeTopUpDailyCostAggregate(
    activeTopUps: TopUpForDailyCost[],
    asOfDate: Date
): DailyCostAmount | null {
    const contributors: Array<{ amount: number; currency: string }> = [];

    for (const topUp of activeTopUps) {
        if (!isActiveTopUp(
            {
                start_date: topUp.startDate,
                end_date: topUp.endDate,
                cancelled_at: topUp.cancelledAt,
            },
            asOfDate
        )) {
            continue;
        }

        if (topUp.premium == null || !Number.isFinite(topUp.premium)) {
            continue;
        }

        const currency = normalizeCurrency(topUp.premiumCurrency);
        if (!currency) {
            continue;
        }

        const dailyRate = computeTopUpDailyRate(
            topUp.premium,
            topUp.startDate,
            topUp.endDate
        );
        if (dailyRate <= 0) {
            continue;
        }

        contributors.push({ amount: dailyRate, currency });
    }

    if (contributors.length === 0) {
        return null;
    }

    const currencies = new Set(contributors.map((row) => row.currency));
    if (currencies.size > 1) {
        return null;
    }

    const currency = contributors[0]!.currency;
    const amount = contributors.reduce((sum, row) => sum + row.amount, 0);
    return { amount, currency };
}

/**
 * Combine policy and top-up daily costs per PRD currency rules.
 */
export function computeTotalDailyCost(
    policyPart: DailyCostAmount | null,
    topUpPart: DailyCostAmount | null
): number | null {
    if (policyPart == null && topUpPart == null) {
        return null;
    }
    if (policyPart != null && topUpPart == null) {
        return policyPart.amount;
    }
    if (policyPart == null && topUpPart != null) {
        return topUpPart.amount;
    }

    if (policyPart!.currency === topUpPart!.currency) {
        return policyPart!.amount + topUpPart!.amount;
    }

    return null;
}

export type CustomerDailyCostSnapshot = {
    policyDailyCost: number | null;
    policyCostCurrency: string | null;
    topUpDailyCost: number | null;
    topUpCostCurrency: string | null;
    totalDailyCost: number | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: number | null;
};

/**
 * Resolve all cost fields for one customer/day trend row.
 */
export function computeCustomerDailyCostSnapshot(args: {
    policyInput: PolicyDailyCostInput;
    activeTopUps: TopUpForDailyCost[];
    asOfDate: Date;
}): CustomerDailyCostSnapshot {
    if (args.policyInput.excludedFromPolicy || args.policyInput.outdatedDcl) {
        const { costCalculationMethod, costPercent } = computePolicyDailyCost(
            args.policyInput
        );
        return {
            policyDailyCost: null,
            policyCostCurrency: null,
            topUpDailyCost: null,
            topUpCostCurrency: null,
            totalDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }

    const policyResult = computePolicyDailyCost(args.policyInput);
    const topUpPart = computeTopUpDailyCostAggregate(
        args.activeTopUps,
        args.asOfDate
    );
    const totalDailyCost = computeTotalDailyCost(
        policyResult.policyDailyCost,
        topUpPart
    );

    return {
        policyDailyCost: policyResult.policyDailyCost?.amount ?? null,
        policyCostCurrency: policyResult.policyDailyCost?.currency ?? null,
        topUpDailyCost: topUpPart?.amount ?? null,
        topUpCostCurrency: topUpPart?.currency ?? null,
        totalDailyCost,
        costCalculationMethod: policyResult.costCalculationMethod,
        costPercent: policyResult.costPercent,
    };
}
