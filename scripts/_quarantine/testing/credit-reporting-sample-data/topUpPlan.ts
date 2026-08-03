import { Prisma } from "@prisma/client";

import {
    TOPUP_CAP_BUSTER_COUNT,
    TOPUP_CUSTOMER_PCT,
    TOPUP_EXPIRING_30D_SPAN_DAYS,
    TOPUP_EXPIRING_7D_SPAN_DAYS,
    TOPUP_FIXED_AMOUNT_MAX_PCT,
    TOPUP_FIXED_AMOUNT_MIN_PCT,
    TOPUP_FIXED_PCT,
    TOPUP_HALF_YEAR_SPAN_DAYS,
    TOPUP_MAX_TOTAL_COVER_ILS,
    TOPUP_PERCENTAGE_MAX_PCT,
    TOPUP_PERCENTAGE_MIN_PCT,
    TOPUP_WAVE_DAYS,
    TOPUP_WINDOW_EXPIRING_30D_PCT,
    TOPUP_WINDOW_EXPIRING_7D_PCT,
    TOPUP_WINDOW_FULL_HALF_YEAR_PCT,
} from "./constants";
import type {
    ScheduledCustomer,
    ScheduledTopUp,
    TopUpBreakdown,
    TopUpWindowKind,
} from "./types";
import type { HistoryWindow } from "./window";
import { addUtcDaysTo, formatUtcDate } from "./window";

function distributeCount(total: number, buckets: number): number[] {
    const base = Math.floor(total / buckets);
    const remainder = total % buckets;
    return Array.from({ length: buckets }, (_, index) =>
        index < remainder ? base + 1 : base
    );
}

function isEligibleForTopUp(customer: ScheduledCustomer): boolean {
    return (
        customer.approvedLimit > 0 &&
        customer.scenario !== "excluded" &&
        customer.scenario !== "zero-limit" &&
        customer.scenario !== "no-policy"
    );
}

function assignWindowKinds(topUpCount: number): TopUpWindowKind[] {
    const fullCount = Math.round(
        (topUpCount * TOPUP_WINDOW_FULL_HALF_YEAR_PCT) / 100
    );
    const expiring30Count = Math.round(
        (topUpCount * TOPUP_WINDOW_EXPIRING_30D_PCT) / 100
    );
    let expiring7Count = Math.round(
        (topUpCount * TOPUP_WINDOW_EXPIRING_7D_PCT) / 100
    );

    const kinds: TopUpWindowKind[] = [
        ...Array.from({ length: fullCount }, () => "full-half-year" as const),
        ...Array.from({ length: expiring30Count }, () => "expiring-30d" as const),
        ...Array.from({ length: expiring7Count }, () => "expiring-7d" as const),
    ];

    while (kinds.length < topUpCount) {
        kinds.push("full-half-year");
    }
    while (kinds.length > topUpCount) {
        const fullIndex = kinds.lastIndexOf("full-half-year");
        if (fullIndex >= 0) {
            kinds.splice(fullIndex, 1);
            continue;
        }
        kinds.pop();
    }

    return kinds;
}

function assignTopUpTypeForCustomer(args: {
    isCapBuster: boolean;
    fixedRemaining: number;
    percentageRemaining: number;
}): {
    topUpType: "Fixed" | "Percentage";
    fixedRemaining: number;
    percentageRemaining: number;
} {
    if (args.isCapBuster) {
        return {
            topUpType: "Fixed",
            fixedRemaining: args.fixedRemaining,
            percentageRemaining: args.percentageRemaining,
        };
    }

    if (args.percentageRemaining > 0 && args.fixedRemaining === 0) {
        return {
            topUpType: "Percentage",
            fixedRemaining: args.fixedRemaining,
            percentageRemaining: args.percentageRemaining - 1,
        };
    }

    if (args.fixedRemaining > 0 && args.percentageRemaining === 0) {
        return {
            topUpType: "Fixed",
            fixedRemaining: args.fixedRemaining - 1,
            percentageRemaining: args.percentageRemaining,
        };
    }

    if (args.fixedRemaining >= args.percentageRemaining) {
        return {
            topUpType: "Fixed",
            fixedRemaining: args.fixedRemaining - 1,
            percentageRemaining: args.percentageRemaining,
        };
    }

    return {
        topUpType: "Percentage",
        fixedRemaining: args.fixedRemaining,
        percentageRemaining: args.percentageRemaining - 1,
    };
}

function assignTopUpsToWaves(
    selected: ScheduledCustomer[],
    windowDays: number
): Array<{ customer: ScheduledCustomer; waveDayIndex: number }> {
    const availableWaves = TOPUP_WAVE_DAYS.filter((day) => day <= windowDays);
    if (availableWaves.length === 0 || selected.length === 0) {
        return [];
    }

    const sortedSelected = [...selected].sort(
        (left, right) => left.dayIndex - right.dayIndex
    );
    const perWave = distributeCount(sortedSelected.length, availableWaves.length);
    const assignments: Array<{
        customer: ScheduledCustomer;
        waveDayIndex: number;
    }> = [];

    let customerPointer = 0;
    for (
        let waveIndex = 0;
        waveIndex < availableWaves.length &&
        customerPointer < sortedSelected.length;
        waveIndex++
    ) {
        const waveDayIndex = availableWaves[waveIndex]!;
        let slotsRemaining = perWave[waveIndex] ?? 0;

        while (
            slotsRemaining > 0 &&
            customerPointer < sortedSelected.length
        ) {
            const customer = sortedSelected[customerPointer]!;
            if (customer.dayIndex > waveDayIndex) {
                break;
            }

            assignments.push({ customer, waveDayIndex });
            customerPointer += 1;
            slotsRemaining -= 1;
        }
    }

    while (customerPointer < sortedSelected.length) {
        const customer = sortedSelected[customerPointer]!;
        const waveDayIndex =
            availableWaves.find((day) => day >= customer.dayIndex) ??
            Math.min(customer.dayIndex, windowDays);
        assignments.push({ customer, waveDayIndex });
        customerPointer += 1;
    }

    return assignments;
}

function resolveModerateFixedAmount(customer: ScheduledCustomer): number {
    const pct =
        TOPUP_FIXED_AMOUNT_MIN_PCT +
        (customer.index %
            (TOPUP_FIXED_AMOUNT_MAX_PCT - TOPUP_FIXED_AMOUNT_MIN_PCT + 1));
    return Math.round((customer.approvedLimit * pct) / 100);
}

function resolveModeratePercentageValue(customer: ScheduledCustomer): number {
    const pct =
        TOPUP_PERCENTAGE_MIN_PCT +
        (customer.index %
            (TOPUP_PERCENTAGE_MAX_PCT - TOPUP_PERCENTAGE_MIN_PCT + 1));
    return pct;
}

function resolveCapBusterAmount(
    capBusterSlot: number,
    capBusterCount: number
): number {
    const base = Math.floor(TOPUP_MAX_TOTAL_COVER_ILS / capBusterCount);
    const remainder = TOPUP_MAX_TOTAL_COVER_ILS - base * capBusterCount;
    return base + (capBusterSlot < remainder ? 1 : 0);
}

export function resolveTopUpEndDate(args: {
    startDate: Date;
    windowKind: TopUpWindowKind;
    window: HistoryWindow;
}): Date {
    const { startDate, windowKind, window } = args;

    switch (windowKind) {
        case "full-half-year": {
            const halfYearEnd = addUtcDaysTo(
                startDate,
                TOPUP_HALF_YEAR_SPAN_DAYS - 1
            );
            return halfYearEnd > window.windowEnd ? window.windowEnd : halfYearEnd;
        }
        case "expiring-30d":
            return addUtcDaysTo(startDate, TOPUP_EXPIRING_30D_SPAN_DAYS - 1);
        case "expiring-7d":
            return addUtcDaysTo(startDate, TOPUP_EXPIRING_7D_SPAN_DAYS - 1);
    }
}

export function buildTopUpSchedule(args: {
    customers: ScheduledCustomer[];
    window: HistoryWindow;
}): {
    topUps: ScheduledTopUp[];
    topUpsByDay: Map<string, ScheduledTopUp[]>;
    breakdown: TopUpBreakdown;
} {
    const topUpCount = Math.max(
        1,
        Math.round((args.customers.length * TOPUP_CUSTOMER_PCT) / 100)
    );
    const capBusterCount = Math.min(TOPUP_CAP_BUSTER_COUNT, topUpCount);

    const eligible = args.customers
        .filter(isEligibleForTopUp)
        .sort((left, right) => {
            if (left.approvedLimitCurrency !== right.approvedLimitCurrency) {
                return left.approvedLimitCurrency === "ILS" ? -1 : 1;
            }
            return right.approvedLimit - left.approvedLimit;
        });

    const capBusterCandidates = eligible
        .filter((customer) => customer.approvedLimitCurrency === "ILS")
        .slice(0, capBusterCount);
    const capBusterIndexes = new Set(
        capBusterCandidates.map((customer) => customer.index)
    );

    const selected: ScheduledCustomer[] = [...capBusterCandidates];
    for (const customer of eligible) {
        if (selected.length >= topUpCount) {
            break;
        }
        if (!capBusterIndexes.has(customer.index)) {
            selected.push(customer);
        }
    }

    const windowKinds = assignWindowKinds(selected.length);
    const waveAssignments = assignTopUpsToWaves(selected, args.window.windowDays);
    const nonCapBusterCount = selected.length - capBusterCandidates.length;
    const targetFixedCount = Math.round(
        (selected.length * TOPUP_FIXED_PCT) / 100
    );
    let fixedRemaining = Math.max(0, targetFixedCount - capBusterCount);
    let percentageRemaining = Math.max(0, nonCapBusterCount - fixedRemaining);

    const topUps: ScheduledTopUp[] = [];
    const topUpsByDay = new Map<string, ScheduledTopUp[]>();
    let capBusterSlot = 0;

    for (let i = 0; i < waveAssignments.length; i++) {
        const { customer, waveDayIndex } = waveAssignments[i]!;
        const isCapBuster = capBusterIndexes.has(customer.index);
        const typeAssignment = assignTopUpTypeForCustomer({
            isCapBuster,
            fixedRemaining,
            percentageRemaining,
        });
        const topUpType = typeAssignment.topUpType;
        fixedRemaining = typeAssignment.fixedRemaining;
        percentageRemaining = typeAssignment.percentageRemaining;
        const windowKind = windowKinds[i] ?? "full-half-year";

        let topUpValue: number;
        let currency: "ILS" | "USD" | null;

        if (isCapBuster) {
            topUpValue = resolveCapBusterAmount(capBusterSlot, capBusterCount);
            currency = "ILS";
            capBusterSlot += 1;
        } else if (topUpType === "Fixed") {
            topUpValue = resolveModerateFixedAmount(customer);
            currency = customer.approvedLimitCurrency;
        } else {
            topUpValue = resolveModeratePercentageValue(customer);
            currency = null;
        }

        const scheduled: ScheduledTopUp = {
            customerIndex: customer.index,
            waveDayIndex,
            topUpType,
            topUpValue,
            currency,
            windowKind,
            isCapBuster,
        };

        topUps.push(scheduled);

        const waveDate = addUtcDaysTo(
            args.window.windowStart,
            waveDayIndex - 1
        );
        const dayKey = formatUtcDate(waveDate);
        const dayTopUps = topUpsByDay.get(dayKey) ?? [];
        dayTopUps.push(scheduled);
        topUpsByDay.set(dayKey, dayTopUps);
    }

    const breakdown: TopUpBreakdown = {
        total: topUps.length,
        fixed: topUps.filter((topUp) => topUp.topUpType === "Fixed").length,
        percentage: topUps.filter((topUp) => topUp.topUpType === "Percentage")
            .length,
        capBusters: topUps.filter((topUp) => topUp.isCapBuster).length,
        fullHalfYear: topUps.filter(
            (topUp) => topUp.windowKind === "full-half-year"
        ).length,
        expiring30d: topUps.filter((topUp) => topUp.windowKind === "expiring-30d")
            .length,
        expiring7d: topUps.filter((topUp) => topUp.windowKind === "expiring-7d")
            .length,
        waveDays: [...new Set(topUps.map((topUp) => topUp.waveDayIndex))].sort(
            (left, right) => left - right
        ),
    };

    return { topUps, topUpsByDay, breakdown };
}

export function formatTopUpBreakdown(breakdown: TopUpBreakdown): string[] {
    const capBusterCover = breakdown.capBusters > 0
        ? new Prisma.Decimal(TOPUP_MAX_TOTAL_COVER_ILS).toFixed(0)
        : "0";

    return [
        `  top-ups: total=${breakdown.total}, fixed=${breakdown.fixed}, percentage=${breakdown.percentage}, cap-busters=${breakdown.capBusters}`,
        `  top-up windows: full-half-year=${breakdown.fullHalfYear}, expiring-30d=${breakdown.expiring30d}, expiring-7d=${breakdown.expiring7d}`,
        `  top-up waves (day index): ${breakdown.waveDays.join(", ") || "none"}`,
        `  cap-buster aggregate cover (ILS): ${capBusterCover}`,
    ];
}
