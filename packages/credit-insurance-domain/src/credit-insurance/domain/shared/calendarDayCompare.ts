/**
 * Normalize a Date to a local calendar midnight for comparisons between:
 * - `@db.Date` fields from PostgreSQL (Prisma uses UTC midnight for the stored day), and
 * - dates parsed from import/API `YYYY-MM-DD` strings (local calendar day).
 *
 * Shared so every credit-insurance calendar-day comparison — insurance target
 * dates, policy end date, the MEP breach start gate — uses one rule.
 */
export function normalizeCalendarDayForInsuranceCompare(d: Date): Date {
    const utcMidnight =
        d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 &&
        d.getUTCMilliseconds() === 0;
    if (utcMidnight) {
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
