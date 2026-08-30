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

/**
 * Same normalization for values that may still be `YYYY-MM-DD` strings, so a
 * string straight off an import compares equal to the stored `@db.Date`.
 */
export function toComparableCalendarDay(value: Date | string): Date {
    if (typeof value === "string") {
        const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (ymd) {
            return new Date(
                Number(ymd[1]),
                Number(ymd[2]) - 1,
                Number(ymd[3])
            );
        }
    }
    const date = value instanceof Date ? value : new Date(value);
    return normalizeCalendarDayForInsuranceCompare(date);
}

/**
 * Shared boundary rule for the start-date gates (MEP breach, reporting breach).
 *
 * No configured start date means every invoice is in scope. A missing invoice
 * date also stays in scope rather than being silently excluded. The boundary is
 * inclusive: an invoice issued exactly on the start date is in scope.
 */
export function isInvoiceOnOrAfterStartDate(
    invoiceDate: Date | string | null | undefined,
    startDate: Date | string | null | undefined
): boolean {
    if (startDate == null || invoiceDate == null) {
        return true;
    }
    return (
        toComparableCalendarDay(invoiceDate).getTime() >=
        toComparableCalendarDay(startDate).getTime()
    );
}
