import { prisma } from "@/lib/prisma";

import type { CheckpointData, ScriptConfig } from "./types";
import {
    addUtcDaysTo,
    dayIndexInWindow,
    formatUtcDate,
    parseUtcDate,
    type HistoryWindow,
} from "./window";
import { CUSTOMER_NUMBER_PREFIX } from "./constants";

export function assertCheckpointCompatible(
    checkpoint: CheckpointData,
    accountId: number,
    window: HistoryWindow
): void {
    if (checkpoint.accountId !== accountId) {
        throw new Error(
            `Checkpoint accountId ${checkpoint.accountId} does not match ${accountId}`
        );
    }
    const windowStartKey = formatUtcDate(window.windowStart);
    if (checkpoint.windowStart !== windowStartKey) {
        throw new Error(
            `Checkpoint windowStart ${checkpoint.windowStart} does not match ${windowStartKey}`
        );
    }
    if (checkpoint.windowDays !== window.windowDays) {
        throw new Error(
            `Checkpoint windowDays ${checkpoint.windowDays} does not match ${window.windowDays}`
        );
    }
}

export function resolveStartDayOffset(
    config: ScriptConfig,
    window: HistoryWindow,
    checkpoint: CheckpointData | null
): number {
    if (config.resumeFrom) {
        const resumeDay = parseUtcDate(config.resumeFrom);
        const windowStart = parseUtcDate(formatUtcDate(window.windowStart));
        const windowEnd = parseUtcDate(formatUtcDate(window.windowEnd));

        if (resumeDay < windowStart || resumeDay > windowEnd) {
            throw new Error(
                `--resume-from ${config.resumeFrom} is outside the active window (${formatUtcDate(window.windowStart)} → ${formatUtcDate(window.windowEnd)})`
            );
        }

        if (
            checkpoint?.lastCompletedDay &&
            resumeDay <= parseUtcDate(checkpoint.lastCompletedDay)
        ) {
            console.warn(
                `[resume] --resume-from ${config.resumeFrom} is on or before checkpoint lastCompletedDay=${checkpoint.lastCompletedDay}; already-processed days will be skipped`
            );
        }

        return dayIndexInWindow(window.windowStart, resumeDay) - 1;
    }

    if (checkpoint?.lastCompletedDay) {
        const nextDay = addUtcDaysTo(
            parseUtcDate(checkpoint.lastCompletedDay),
            1
        );
        if (nextDay > window.windowEnd) {
            return window.windowDays;
        }
        return dayIndexInWindow(window.windowStart, nextDay) - 1;
    }

    return 0;
}

export async function loadCustomerIdByIndex(
    accountId: number
): Promise<Map<number, number>> {
    const customers = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            customer_number: { startsWith: `${CUSTOMER_NUMBER_PREFIX}-` },
        },
        select: {
            id: true,
            customer_number: true,
        },
    });

    const customerIdByIndex = new Map<number, number>();
    for (const customer of customers) {
        const suffix = customer.customer_number.replace(
            `${CUSTOMER_NUMBER_PREFIX}-`,
            ""
        );
        const index = Number.parseInt(suffix, 10) - 1;
        if (Number.isFinite(index) && index >= 0) {
            customerIdByIndex.set(index, customer.id);
        }
    }

    return customerIdByIndex;
}
