import { toComparableCalendarDay } from "@archaser/credit-insurance-domain";

export type PolicyAnniversaryYear = {
    /** 1-based anniversary year index from policy start_date. */
    yearIndex: number;
    yearStart: Date;
    /** Inclusive end of the anniversary year (clipped by policy end_date). */
    yearEnd: Date;
};

function addCalendarYears(day: Date, years: number): Date {
    return new Date(day.getFullYear() + years, day.getMonth(), day.getDate());
}

function addCalendarDays(day: Date, days: number): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
}

/**
 * Resolve which Primary-policy anniversary year contains `asOfDate`.
 *
 * Year 1 = start_date .. start_date+1y−1d (inclusive), then year 2, etc.
 * Windows are clipped by policy `end_date` when set. Returns null when the
 * date falls outside the policy term.
 */
export function resolvePolicyAnniversaryYear(args: {
    policyStartDate: Date | string;
    policyEndDate?: Date | string | null;
    asOfDate: Date | string;
}): PolicyAnniversaryYear | null {
    const start = toComparableCalendarDay(args.policyStartDate);
    const asOf = toComparableCalendarDay(args.asOfDate);
    const end =
        args.policyEndDate == null
            ? null
            : toComparableCalendarDay(args.policyEndDate);

    if (asOf.getTime() < start.getTime()) {
        return null;
    }
    if (end != null && asOf.getTime() > end.getTime()) {
        return null;
    }

    let yearIndex = 1;
    let yearStart = start;
    // Cap iterations — policy terms are typically a few years, not centuries.
    for (let i = 0; i < 200; i++) {
        const nextStart = addCalendarYears(start, yearIndex);
        let yearEnd = addCalendarDays(nextStart, -1);
        if (end != null && yearEnd.getTime() > end.getTime()) {
            yearEnd = end;
        }
        if (
            asOf.getTime() >= yearStart.getTime() &&
            asOf.getTime() <= yearEnd.getTime()
        ) {
            return { yearIndex, yearStart, yearEnd };
        }
        if (end != null && nextStart.getTime() > end.getTime()) {
            return null;
        }
        yearIndex += 1;
        yearStart = nextStart;
    }
    return null;
}

/**
 * List anniversary years that overlap the policy term (useful for remaining-excess).
 */
export function listPolicyAnniversaryYears(args: {
    policyStartDate: Date | string;
    policyEndDate?: Date | string | null;
    /** Optional max years to list (default 20). */
    maxYears?: number;
}): PolicyAnniversaryYear[] {
    const start = toComparableCalendarDay(args.policyStartDate);
    const end =
        args.policyEndDate == null
            ? null
            : toComparableCalendarDay(args.policyEndDate);
    const maxYears = args.maxYears ?? 20;
    const years: PolicyAnniversaryYear[] = [];

    for (let yearIndex = 1; yearIndex <= maxYears; yearIndex++) {
        const yearStart = addCalendarYears(start, yearIndex - 1);
        if (end != null && yearStart.getTime() > end.getTime()) {
            break;
        }
        const nextStart = addCalendarYears(start, yearIndex);
        let yearEnd = addCalendarDays(nextStart, -1);
        if (end != null && yearEnd.getTime() > end.getTime()) {
            yearEnd = end;
        }
        years.push({ yearIndex, yearStart, yearEnd });
        if (end != null && yearEnd.getTime() >= end.getTime()) {
            break;
        }
    }
    return years;
}
