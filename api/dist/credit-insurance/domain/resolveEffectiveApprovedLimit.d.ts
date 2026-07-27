import { Prisma } from "@prisma/client";
import { type DbClient } from "../domain-db";
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
export declare function isActiveTopUp(row: {
    start_date: Date;
    end_date: Date;
    cancelled_at: Date | null;
}, asOfDate: Date): boolean;
export declare function resolveTopUpMonetaryAmount(row: {
    top_up_type: string;
    top_up_value: Prisma.Decimal;
}, baseApprovedLimit: Prisma.Decimal | null | undefined): number;
export declare function resolveEffectiveApprovedLimit(customerId: number, options?: {
    asOfDate?: Date;
    baseApprovedLimit?: Prisma.Decimal | null;
    baseApprovedLimitCurrency?: string | null;
    outdatedDcl?: boolean;
    excludedFromPolicy?: boolean;
    parentPrimaryPolicyId?: number;
    dbClient?: DbClient;
}): Promise<EffectiveApprovedLimitResult>;
