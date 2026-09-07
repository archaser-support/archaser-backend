const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PORTFOLIO_HEALTH_MAX_RANGE_DAYS = 366;

export type ParsedPortfolioHealthDateRange = {
    from: string;
    to: string;
    fromDateUtc: Date;
    toDateUtc: Date;
    daysInRange: number;
};

function startOfUtcDayFromYmd(ymd: string): Date {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

/** Inclusive calendar-day count between YYYY-MM-DD bounds (UTC). */
export function countInclusiveCalendarDays(fromYmd: string, toYmd: string): number {
    const from = startOfUtcDayFromYmd(fromYmd);
    const to = startOfUtcDayFromYmd(toYmd);
    const ms = to.getTime() - from.getTime();
    return Math.floor(ms / 86_400_000) + 1;
}

/** Default range: calendar This Year (Jan 1–Dec 31, UTC year of `todayUtc`). */
export function defaultPortfolioHealthDateRange(
    todayUtc: Date = new Date(
        Date.UTC(
            new Date().getUTCFullYear(),
            new Date().getUTCMonth(),
            new Date().getUTCDate()
        )
    )
): { from: string; to: string } {
    const year = todayUtc.getUTCFullYear();
    return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
    };
}

export function parsePortfolioHealthDateRange(
    fromRaw: string | undefined,
    toRaw: string | undefined
): ParsedPortfolioHealthDateRange | { error: string } {
    const defaults = defaultPortfolioHealthDateRange();
    const from = (fromRaw ?? "").trim() || defaults.from;
    const to = (toRaw ?? "").trim() || defaults.to;

    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return { error: "Invalid from/to date; expected YYYY-MM-DD" };
    }

    const fromDateUtc = startOfUtcDayFromYmd(from);
    const toDateUtc = startOfUtcDayFromYmd(to);
    if (
        Number.isNaN(fromDateUtc.getTime()) ||
        Number.isNaN(toDateUtc.getTime())
    ) {
        return { error: "Invalid from/to date" };
    }
    if (fromDateUtc.getTime() > toDateUtc.getTime()) {
        return { error: "from must be on or before to" };
    }

    const daysInRange = countInclusiveCalendarDays(from, to);
    if (daysInRange > PORTFOLIO_HEALTH_MAX_RANGE_DAYS) {
        return {
            error: `Date range cannot exceed ${PORTFOLIO_HEALTH_MAX_RANGE_DAYS} days`,
        };
    }

    return { from, to, fromDateUtc, toDateUtc, daysInRange };
}
