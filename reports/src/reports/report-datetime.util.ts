/**
 * Format a calendar-date field for display/export (no time component).
 * Uses UTC so `@db.Date` values are not shifted by account/user timezone.
 */
export function formatReportDate(date: Date, locale: string): string {
    const options: Intl.DateTimeFormatOptions = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    };
    return date.toLocaleDateString(locale, options);
}

/**
 * Format a report datetime for display.
 * Aligns with frontend `formatDateForDisplay` (locale for pattern, IANA timezone for clock).
 */
export function formatReportDateTime(
    date: Date,
    locale: string,
    timezone?: string
): string {
    const options: Intl.DateTimeFormatOptions = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        // Match frontend: 24h for Hebrew, 12h otherwise
        hour12: locale !== "he-IL",
        ...(timezone ? { timeZone: timezone } : {}),
    };
    return date.toLocaleString(locale, options);
}
