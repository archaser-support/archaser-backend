import { parseExpression } from "cron-parser";

export type ConnectorScheduleSyncMode = "BACKFILL" | "INCREMENTAL";

export type SchedulePreset =
    | "every_4h"
    | "every_6h"
    | "every_12h"
    | "daily"
    | "weekly"
    | "custom";

export interface PresetToCronOptions {
    dailyTimeUtc?: string;
    weeklyDay?: number;
}

export interface CronToPresetResult {
    schedule_preset: SchedulePreset | null;
    daily_time_utc?: string;
    weekly_day?: number;
}

const WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
] as const;

const PRESET_CRON_PATTERNS: Record<string, string> = {
    "0 */4 * * *": "Every 4 hours UTC",
    "0 */6 * * *": "Every 6 hours UTC",
    "0 */12 * * *": "Every 12 hours UTC",
};

export interface ConnectorDueCheckInput {
    syncMode: ConnectorScheduleSyncMode;
    syncCronExpression: string;
    now: Date;
    lastScheduledIncrementalSuccessAt: Date | null;
    hasScheduledIncrementalSuccess: boolean;
    connectorModifiedAt: Date;
}

function parseCronUtc(expression: string, currentDate?: Date) {
    return parseExpression(expression, {
        utc: true,
        currentDate: currentDate ?? new Date(),
    });
}

export function hasCronFiredBetween(
    cronExpression: string,
    from: Date,
    to: Date
): boolean {
    if (from.getTime() >= to.getTime()) {
        return false;
    }

    try {
        const interval = parseCronUtc(cronExpression, from);
        const nextFire = interval.next().toDate();
        return nextFire.getTime() <= to.getTime();
    } catch {
        return false;
    }
}

export function isConnectorDue(input: ConnectorDueCheckInput): boolean {
    if (input.syncMode === "BACKFILL") {
        return true;
    }

    if (!input.hasScheduledIncrementalSuccess) {
        return true;
    }

    const anchor = input.lastScheduledIncrementalSuccessAt;

    if (
        anchor &&
        input.connectorModifiedAt.getTime() > anchor.getTime() &&
        hasCronFiredBetween(
            input.syncCronExpression,
            input.connectorModifiedAt,
            input.now
        )
    ) {
        return true;
    }

    if (!anchor) {
        return hasCronFiredBetween(
            input.syncCronExpression,
            input.connectorModifiedAt,
            input.now
        );
    }

    return hasCronFiredBetween(
        input.syncCronExpression,
        anchor,
        input.now
    );
}

export function computeNextScheduledSyncAt(
    cronExpression: string,
    lastScheduledIncrementalSuccessAt: Date | null,
    now: Date,
    connectorModifiedAt?: Date | null
): Date | null {
    try {
        let reference = lastScheduledIncrementalSuccessAt ?? connectorModifiedAt ?? now;

        if (lastScheduledIncrementalSuccessAt && connectorModifiedAt) {
            reference =
                connectorModifiedAt.getTime() >
                lastScheduledIncrementalSuccessAt.getTime()
                    ? connectorModifiedAt
                    : lastScheduledIncrementalSuccessAt;
        }

        const interval = parseCronUtc(cronExpression, reference);
        let next = interval.next().toDate();

        if (next.getTime() <= now.getTime()) {
            const fromNow = parseCronUtc(cronExpression, now);
            next = fromNow.next().toDate();
        }

        return next;
    } catch {
        return null;
    }
}

function formatUtcTime(hour: number, minute: number): string {
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseUtcTime(time: string): { hour: number; minute: number } {
    const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    if (!match) {
        throw new Error("daily_time_utc must be HH:mm in UTC");
    }

    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);

    if (
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
    ) {
        throw new Error("daily_time_utc must be HH:mm in UTC");
    }

    return { hour, minute };
}

export function presetToCron(
    preset: Exclude<SchedulePreset, "custom">,
    options?: PresetToCronOptions
): string {
    switch (preset) {
        case "every_4h":
            return "0 */4 * * *";
        case "every_6h":
            return "0 */6 * * *";
        case "every_12h":
            return "0 */12 * * *";
        case "daily": {
            const { hour, minute } = parseUtcTime(options?.dailyTimeUtc ?? "03:00");
            return `${minute} ${hour} * * *`;
        }
        case "weekly": {
            const { hour, minute } = parseUtcTime(options?.dailyTimeUtc ?? "03:00");
            const dayOfWeek = options?.weeklyDay ?? 1;
            if (
                !Number.isInteger(dayOfWeek) ||
                dayOfWeek < 0 ||
                dayOfWeek > 6
            ) {
                throw new Error("weekly_day must be an integer from 0 (Sunday) to 6 (Saturday)");
            }
            return `${minute} ${hour} * * ${dayOfWeek}`;
        }
        default: {
            const _exhaustive: never = preset;
            return _exhaustive;
        }
    }
}

export function cronToPreset(cronExpression: string): CronToPresetResult {
    const trimmed = cronExpression.trim();

    if (trimmed === "0 */4 * * *") {
        return { schedule_preset: "every_4h" };
    }
    if (trimmed === "0 */6 * * *") {
        return { schedule_preset: "every_6h" };
    }
    if (trimmed === "0 */12 * * *") {
        return { schedule_preset: "every_12h" };
    }

    const dailyMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(trimmed);
    if (dailyMatch) {
        const minute = Number.parseInt(dailyMatch[1], 10);
        const hour = Number.parseInt(dailyMatch[2], 10);
        return {
            schedule_preset: "daily",
            daily_time_utc: formatUtcTime(hour, minute),
        };
    }

    const weeklyMatch = /^(\d{1,2}) (\d{1,2}) \* \* (\d{1})$/.exec(trimmed);
    if (weeklyMatch) {
        const minute = Number.parseInt(weeklyMatch[1], 10);
        const hour = Number.parseInt(weeklyMatch[2], 10);
        const dayOfWeek = Number.parseInt(weeklyMatch[3], 10);
        return {
            schedule_preset: "weekly",
            daily_time_utc: formatUtcTime(hour, minute),
            weekly_day: dayOfWeek,
        };
    }

    return { schedule_preset: "custom" };
}

export function describeSchedule(cronExpression: string): string {
    const trimmed = cronExpression.trim();
    const presetSummary = PRESET_CRON_PATTERNS[trimmed];
    if (presetSummary) {
        return presetSummary;
    }

    const dailyMatch = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(trimmed);
    if (dailyMatch) {
        const minute = Number.parseInt(dailyMatch[1], 10);
        const hour = Number.parseInt(dailyMatch[2], 10);
        return `Daily at ${formatUtcTime(hour, minute)} UTC`;
    }

    const weeklyMatch = /^(\d{1,2}) (\d{1,2}) \* \* (\d{1})$/.exec(trimmed);
    if (weeklyMatch) {
        const minute = Number.parseInt(weeklyMatch[1], 10);
        const hour = Number.parseInt(weeklyMatch[2], 10);
        const dayOfWeek = Number.parseInt(weeklyMatch[3], 10);
        const dayName = WEEKDAY_NAMES[dayOfWeek] ?? `day ${dayOfWeek}`;
        return `Weekly on ${dayName} at ${formatUtcTime(hour, minute)} UTC`;
    }

    return `${trimmed} (UTC)`;
}
