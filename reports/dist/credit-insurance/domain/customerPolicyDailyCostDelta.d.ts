import type { CustomerDailyCostSnapshot } from "./customerPolicyDailyCost";
export declare const MAX_GAP_FILL_DAYS = 7;
/**
 * Day-over-day change for one cost component.
 * Null today level → null delta; missing/null predecessor level → 0.
 */
export declare function computeComponentDailyCostDelta(args: {
    todayAmount: number | null;
    todayCurrency: string | null;
    predecessorAmount: number | null;
    predecessorCurrency: string | null;
    hasPredecessor: boolean;
}): number | null;
/**
 * Combine policy and top-up deltas using the same partial rules as level totals.
 */
export declare function computeTotalDailyCostDelta(policyDelta: number | null, policyCurrency: string | null, topUpDelta: number | null, topUpCurrency: string | null): number | null;
/**
 * Derive stored delta fields from today's computed levels and predecessor levels.
 */
export declare function deriveDailyCostDeltaSnapshot(args: {
    todayLevels: CustomerDailyCostSnapshot;
    predecessorLevels: CustomerDailyCostSnapshot | null;
}): CustomerDailyCostSnapshot;
export type GapFillDateResolution = {
    datesToSync: Date[];
    gapDays: number;
    gapExceedsCap: boolean;
};
/**
 * Ordered UTC dates to sync after the account's latest snapshot and before today.
 */
export declare function resolveGapFillDates(args: {
    lastSnapshotDate: Date | null;
    todayUtc: Date;
    maxDays?: number;
}): GapFillDateResolution;
