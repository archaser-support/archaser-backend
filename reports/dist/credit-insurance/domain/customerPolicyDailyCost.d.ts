import type { cost_calculation_method } from "@prisma/client";
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
export declare function inclusiveUtcCalendarDays(startDate: Date, endDate: Date): number;
/**
 * Primary policy daily cost from cost config, approved limit, and usage amount.
 * Cost % is a daily rate (not annual ÷ 365).
 */
export declare function computePolicyDailyCost(input: PolicyDailyCostInput): PolicyDailyCostResult;
/**
 * Sum active top-ups' daily premium rates when premium currencies match.
 */
export declare function computeTopUpDailyCostAggregate(activeTopUps: TopUpForDailyCost[], asOfDate: Date): DailyCostAmount | null;
/**
 * Combine policy and top-up daily costs per PRD currency rules.
 */
export declare function computeTotalDailyCost(policyPart: DailyCostAmount | null, topUpPart: DailyCostAmount | null): number | null;
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
export declare function computeCustomerDailyCostSnapshot(args: {
    policyInput: PolicyDailyCostInput;
    activeTopUps: TopUpForDailyCost[];
    asOfDate: Date;
}): CustomerDailyCostSnapshot;
