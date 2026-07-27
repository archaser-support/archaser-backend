import type { CustomerDailyCostSnapshot } from "./customerPolicyDailyCost";
export declare const MAX_GAP_FILL_DAYS = 7;
export declare function computeComponentDailyCostDelta(args: {
    todayAmount: number | null;
    todayCurrency: string | null;
    predecessorAmount: number | null;
    predecessorCurrency: string | null;
    hasPredecessor: boolean;
}): number | null;
export declare function computeTotalDailyCostDelta(policyDelta: number | null, policyCurrency: string | null, topUpDelta: number | null, topUpCurrency: string | null): number | null;
export declare function deriveDailyCostDeltaSnapshot(args: {
    todayLevels: CustomerDailyCostSnapshot;
    predecessorLevels: CustomerDailyCostSnapshot | null;
}): CustomerDailyCostSnapshot;
export type GapFillDateResolution = {
    datesToSync: Date[];
    gapDays: number;
    gapExceedsCap: boolean;
};
export declare function resolveGapFillDates(args: {
    lastSnapshotDate: Date | null;
    todayUtc: Date;
    maxDays?: number;
}): GapFillDateResolution;
