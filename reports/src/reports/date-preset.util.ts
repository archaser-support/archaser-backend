/**
 * Server-side date preset resolver for report filters.
 *
 * FilterBuilder (client) persists relative date filters as marker objects
 * like `{ __datePreset: "today" }` inside report_config / execute payloads and
 * only resolves them for display. The server must resolve the same markers to
 * concrete dates at query time — otherwise the raw marker object reaches Prisma
 * and the query throws (`Argument _ref is missing`).
 *
 * Mirrors frontend/utils/datePresetUtils.ts. Kept as a standalone copy because
 * the backend tsconfig cannot import from the frontend package.
 */

export type DatePreset =
    | "today"
    | "yesterday"
    | "tomorrow"
    | "this_week"
    | "last_week"
    | "next_week"
    | "this_month"
    | "last_month"
    | "next_month"
    | "last_x_days"
    | "last_x_months"
    | "next_x_days"
    | "next_x_months";

export type DatePresetMarker = {
    __datePreset: DatePreset;
    __datePresetInput?: number;
};

export function isDatePresetMarker(value: unknown): value is DatePresetMarker {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        "__datePreset" in value &&
        typeof (value as { __datePreset: unknown }).__datePreset === "string"
    );
}

const PERIOD_PRESETS: ReadonlySet<DatePreset> = new Set<DatePreset>([
    "this_week",
    "last_week",
    "next_week",
    "this_month",
    "last_month",
    "next_month",
    "last_x_days",
    "last_x_months",
    "next_x_days",
    "next_x_months",
]);

export function isPeriodPreset(preset: DatePreset): boolean {
    return PERIOD_PRESETS.has(preset);
}

function toYMD(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

function startOfToday(now: Date = new Date()): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function lastDayOfMonth(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** Resolve a single-date (point) preset to a YYYY-MM-DD string, or null. */
export function resolveDatePreset(
    preset: DatePreset,
    inputValue?: number,
    now: Date = new Date()
): string | null {
    const today = startOfToday(now);
    let d: Date;

    switch (preset) {
        case "today":
            d = new Date(today);
            break;
        case "yesterday":
            d = new Date(today);
            d.setDate(today.getDate() - 1);
            break;
        case "tomorrow":
            d = new Date(today);
            d.setDate(today.getDate() + 1);
            break;
        case "this_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay());
            break;
        case "last_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay() - 7);
            break;
        case "next_week":
            d = new Date(today);
            d.setDate(today.getDate() - today.getDay() + 7);
            break;
        case "this_month":
            d = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case "last_month":
            d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            break;
        case "next_month":
            d = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            break;
        case "last_x_days":
            d = new Date(today);
            d.setDate(today.getDate() - (inputValue ?? 7));
            break;
        case "last_x_months":
            d = new Date(
                today.getFullYear(),
                today.getMonth() - (inputValue ?? 1),
                1
            );
            break;
        case "next_x_days":
            d = new Date(today);
            d.setDate(today.getDate() + (inputValue ?? 7));
            break;
        case "next_x_months":
            d = new Date(
                today.getFullYear(),
                today.getMonth() + (inputValue ?? 1),
                1
            );
            break;
        default:
            return null;
    }

    return toYMD(d);
}

/**
 * Resolve a period preset to a [startYMD, endYMD] range.
 * Returns null for point presets / unknown presets.
 */
export function resolveDatePresetRange(
    preset: DatePreset,
    inputValue?: number,
    now: Date = new Date()
): [string, string] | null {
    if (!isPeriodPreset(preset)) {
        return null;
    }
    const today = startOfToday(now);
    let start: Date;
    let end: Date;

    switch (preset) {
        case "this_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay());
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "last_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay() - 7);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "next_week": {
            start = new Date(today);
            start.setDate(today.getDate() - today.getDay() + 7);
            end = new Date(start);
            end.setDate(start.getDate() + 6);
            break;
        }
        case "this_month": {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "last_month": {
            start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "next_month": {
            start = new Date(today.getFullYear(), today.getMonth() + 1, 1);
            end = lastDayOfMonth(start);
            break;
        }
        case "last_x_days": {
            end = new Date(today);
            start = new Date(today);
            start.setDate(today.getDate() - (inputValue ?? 7));
            break;
        }
        case "last_x_months": {
            start = new Date(
                today.getFullYear(),
                today.getMonth() - (inputValue ?? 1),
                1
            );
            end = lastDayOfMonth(start);
            break;
        }
        case "next_x_days": {
            start = new Date(today);
            end = new Date(today);
            end.setDate(today.getDate() + (inputValue ?? 7));
            break;
        }
        case "next_x_months": {
            start = new Date(
                today.getFullYear(),
                today.getMonth() + (inputValue ?? 1),
                1
            );
            end = lastDayOfMonth(start);
            break;
        }
        default:
            return null;
    }

    return [toYMD(start), toYMD(end)];
}
