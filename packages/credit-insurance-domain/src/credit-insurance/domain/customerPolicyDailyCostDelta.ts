import type {
    CustomerDailyCostSnapshot,
} from "./customerPolicyDailyCost";
import { computeTotalDailyCost } from "./customerPolicyDailyCost";

export const MAX_GAP_FILL_DAYS = 7;

function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function addUtcCalendarDays(base: Date, days: number): Date {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function utcCalendarDaysBetween(start: Date, end: Date): number {
    const startDay = startOfUtcDay(start);
    const endDay = startOfUtcDay(end);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((endDay.getTime() - startDay.getTime()) / msPerDay);
}

function normalizeCurrency(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed.toUpperCase() : null;
}

/**
 * Day-over-day change for one cost component.
 * Null today level → null delta; missing/null predecessor level → 0.
 */
export function computeComponentDailyCostDelta(args: {
    todayAmount: number | null;
    todayCurrency: string | null;
    predecessorAmount: number | null;
    predecessorCurrency: string | null;
    hasPredecessor: boolean;
}): number | null {
    if (args.todayAmount == null) {
        return null;
    }

    if (!args.hasPredecessor || args.predecessorAmount == null) {
        return 0;
    }

    const todayCurrency = normalizeCurrency(args.todayCurrency);
    const predecessorCurrency = normalizeCurrency(args.predecessorCurrency);
    if (
        todayCurrency == null ||
        predecessorCurrency == null ||
        todayCurrency !== predecessorCurrency
    ) {
        return null;
    }

    return args.todayAmount - args.predecessorAmount;
}

/**
 * Combine policy and top-up deltas using the same partial rules as level totals.
 */
export function computeTotalDailyCostDelta(
    policyDelta: number | null,
    policyCurrency: string | null,
    topUpDelta: number | null,
    topUpCurrency: string | null
): number | null {
    const policyPart =
        policyDelta != null && policyCurrency != null
            ? { amount: policyDelta, currency: policyCurrency }
            : null;
    const topUpPart =
        topUpDelta != null && topUpCurrency != null
            ? { amount: topUpDelta, currency: topUpCurrency }
            : null;

    return computeTotalDailyCost(policyPart, topUpPart);
}

/**
 * Derive stored delta fields from today's computed levels and predecessor levels.
 */
export function deriveDailyCostDeltaSnapshot(args: {
    todayLevels: CustomerDailyCostSnapshot;
    predecessorLevels: CustomerDailyCostSnapshot | null;
}): CustomerDailyCostSnapshot {
    const hasPredecessor = args.predecessorLevels != null;

    const policyDailyCost = computeComponentDailyCostDelta({
        todayAmount: args.todayLevels.policyDailyCost,
        todayCurrency: args.todayLevels.policyCostCurrency,
        predecessorAmount: args.predecessorLevels?.policyDailyCost ?? null,
        predecessorCurrency: args.predecessorLevels?.policyCostCurrency ?? null,
        hasPredecessor,
    });
    const topUpDailyCost = computeComponentDailyCostDelta({
        todayAmount: args.todayLevels.topUpDailyCost,
        todayCurrency: args.todayLevels.topUpCostCurrency,
        predecessorAmount: args.predecessorLevels?.topUpDailyCost ?? null,
        predecessorCurrency: args.predecessorLevels?.topUpCostCurrency ?? null,
        hasPredecessor,
    });
    const totalDailyCost = computeTotalDailyCostDelta(
        policyDailyCost,
        args.todayLevels.policyCostCurrency,
        topUpDailyCost,
        args.todayLevels.topUpCostCurrency
    );

    return {
        policyDailyCost,
        policyCostCurrency: args.todayLevels.policyCostCurrency,
        topUpDailyCost,
        topUpCostCurrency: args.todayLevels.topUpCostCurrency,
        totalDailyCost,
        costCalculationMethod: args.todayLevels.costCalculationMethod,
        costPercent: args.todayLevels.costPercent,
    };
}

export type GapFillDateResolution = {
    datesToSync: Date[];
    gapDays: number;
    gapExceedsCap: boolean;
};

/**
 * Ordered UTC dates to sync after the account's latest snapshot and before today.
 */
export function resolveGapFillDates(args: {
    lastSnapshotDate: Date | null;
    todayUtc: Date;
    maxDays?: number;
}): GapFillDateResolution {
    const maxDays = args.maxDays ?? MAX_GAP_FILL_DAYS;
    const today = startOfUtcDay(args.todayUtc);
    const yesterday = addUtcCalendarDays(today, -1);

    if (args.lastSnapshotDate == null) {
        return { datesToSync: [], gapDays: 0, gapExceedsCap: false };
    }

    const lastDate = startOfUtcDay(args.lastSnapshotDate);
    const firstMissing = addUtcCalendarDays(lastDate, 1);

    if (firstMissing.getTime() > yesterday.getTime()) {
        return { datesToSync: [], gapDays: 0, gapExceedsCap: false };
    }

    const gapDays = utcCalendarDaysBetween(firstMissing, yesterday) + 1;
    const gapExceedsCap = gapDays > maxDays;

    const fillEnd = yesterday;
    const fillStart = gapExceedsCap
        ? addUtcCalendarDays(yesterday, -(maxDays - 1))
        : firstMissing;

    const datesToSync: Date[] = [];
    for (
        let cursor = new Date(fillStart.getTime());
        cursor.getTime() <= fillEnd.getTime();
        cursor = addUtcCalendarDays(cursor, 1)
    ) {
        datesToSync.push(new Date(cursor.getTime()));
    }

    return { datesToSync, gapDays, gapExceedsCap };
}
