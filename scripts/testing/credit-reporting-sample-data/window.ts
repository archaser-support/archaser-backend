import { POLICY_PADDING_DAYS } from "./constants";
import type { HistoryWindow } from "./types";

function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function addUtcDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

export function formatUtcDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

export function parseUtcDate(dateKey: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
    if (!match) {
        throw new Error(`Invalid UTC date: ${dateKey} (expected YYYY-MM-DD)`);
    }
    const year = Number.parseInt(match[1]!, 10);
    const month = Number.parseInt(match[2]!, 10);
    const day = Number.parseInt(match[3]!, 10);
    return new Date(Date.UTC(year, month - 1, day));
}

export function formatDuration(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return "—";
    }
    const totalSeconds = Math.round(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
}

export function addUtcDaysTo(date: Date, days: number): Date {
    return addUtcDays(date, days);
}

export function dayIndexInWindow(windowStart: Date, day: Date): number {
    const start = startOfUtcDay(windowStart).getTime();
    const current = startOfUtcDay(day).getTime();
    return Math.round((current - start) / (24 * 60 * 60 * 1000)) + 1;
}

export function computeHistoryWindow(windowDays: number): HistoryWindow {
    const windowEnd = startOfUtcDay(new Date());
    const windowStart = addUtcDays(windowEnd, -(windowDays - 1));
    const policyStart = addUtcDays(windowStart, -POLICY_PADDING_DAYS);
    const policyEnd = addUtcDays(windowEnd, POLICY_PADDING_DAYS);

    return {
        windowDays,
        windowStart,
        windowEnd,
        policyStart,
        policyEnd,
    };
}

export function formatWindowSummary(window: HistoryWindow): string {
    const spanDays =
        Math.round(
            (window.policyEnd.getTime() - window.policyStart.getTime()) /
                (24 * 60 * 60 * 1000)
        ) + 1;

    return [
        `window: ${formatUtcDate(window.windowStart)} → ${formatUtcDate(window.windowEnd)} (${window.windowDays} days)`,
        `policy span: ${formatUtcDate(window.policyStart)} → ${formatUtcDate(window.policyEnd)} (${spanDays} days)`,
    ].join("\n");
}
