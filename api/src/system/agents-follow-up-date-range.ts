/**
 * Date-range filter for Agents Scheduled Follow-ups.
 * Mirrors frontend toolbar values: today | this_week | next_week | this_month | all.
 */

export type AgentsFollowUpDateRange =
    | "today"
    | "this_week"
    | "next_week"
    | "this_month"
    | "all";

export type FollowUpTimeWhere =
    | { not: null }
    | { not: null; gte: Date; lt: Date };

function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Sunday-start week, same convention as report date presets. */
function startOfWeekSunday(d: Date): Date {
    const start = startOfDay(d);
    start.setDate(start.getDate() - start.getDay());
    return start;
}

/**
 * Prisma `follow_up_time` filter for open scheduled follow-ups.
 * Always requires a non-null time. `"all"` = any scheduled time (past or future).
 */
export function followUpTimeWhere(
    range: string | undefined,
    now: Date = new Date()
): FollowUpTimeWhere {
    const normalized = (range || "all").trim().toLowerCase();
    if (
        normalized !== "today" &&
        normalized !== "this_week" &&
        normalized !== "next_week" &&
        normalized !== "this_month"
    ) {
        return { not: null };
    }

    const today = startOfDay(now);

    if (normalized === "today") {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return { not: null, gte: today, lt: tomorrow };
    }

    if (normalized === "this_week") {
        const start = startOfWeekSunday(today);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        return { not: null, gte: start, lt: end };
    }

    if (normalized === "next_week") {
        const start = startOfWeekSunday(today);
        start.setDate(start.getDate() + 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 7);
        return { not: null, gte: start, lt: end };
    }

    // this_month
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { not: null, gte: start, lt: end };
}
