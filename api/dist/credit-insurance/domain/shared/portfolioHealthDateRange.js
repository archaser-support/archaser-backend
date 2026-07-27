"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PORTFOLIO_HEALTH_MAX_RANGE_DAYS = void 0;
exports.countInclusiveCalendarDays = countInclusiveCalendarDays;
exports.defaultPortfolioHealthDateRange = defaultPortfolioHealthDateRange;
exports.parsePortfolioHealthDateRange = parsePortfolioHealthDateRange;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
exports.PORTFOLIO_HEALTH_MAX_RANGE_DAYS = 366;
function startOfUtcDayFromYmd(ymd) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}
function normalizeDateString(value) {
    return value.toISOString().slice(0, 10);
}
function countInclusiveCalendarDays(fromYmd, toYmd) {
    const from = startOfUtcDayFromYmd(fromYmd);
    const to = startOfUtcDayFromYmd(toYmd);
    const ms = to.getTime() - from.getTime();
    return Math.floor(ms / 86_400_000) + 1;
}
function defaultPortfolioHealthDateRange(todayUtc = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()))) {
    const to = normalizeDateString(todayUtc);
    const fromDate = new Date(todayUtc.getTime());
    fromDate.setUTCDate(fromDate.getUTCDate() - 29);
    return { from: normalizeDateString(fromDate), to };
}
function parsePortfolioHealthDateRange(fromRaw, toRaw) {
    const defaults = defaultPortfolioHealthDateRange();
    const from = (fromRaw ?? "").trim() || defaults.from;
    const to = (toRaw ?? "").trim() || defaults.to;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return { error: "Invalid from/to date; expected YYYY-MM-DD" };
    }
    const fromDateUtc = startOfUtcDayFromYmd(from);
    const toDateUtc = startOfUtcDayFromYmd(to);
    if (Number.isNaN(fromDateUtc.getTime()) ||
        Number.isNaN(toDateUtc.getTime())) {
        return { error: "Invalid from/to date" };
    }
    if (fromDateUtc.getTime() > toDateUtc.getTime()) {
        return { error: "from must be on or before to" };
    }
    const daysInRange = countInclusiveCalendarDays(from, to);
    if (daysInRange > exports.PORTFOLIO_HEALTH_MAX_RANGE_DAYS) {
        return {
            error: `Date range cannot exceed ${exports.PORTFOLIO_HEALTH_MAX_RANGE_DAYS} days`,
        };
    }
    return { from, to, fromDateUtc, toDateUtc, daysInRange };
}
//# sourceMappingURL=portfolioHealthDateRange.js.map