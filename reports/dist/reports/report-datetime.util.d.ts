/**
 * Format a calendar-date field for display/export (no time component).
 * Uses UTC so `@db.Date` values are not shifted by account/user timezone.
 */
export declare function formatReportDate(date: Date, locale: string): string;
/**
 * Format a report datetime for display.
 * Aligns with frontend `formatDateForDisplay` (locale for pattern, IANA timezone for clock).
 */
export declare function formatReportDateTime(date: Date, locale: string, timezone?: string): string;
