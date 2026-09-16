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

/** UTC YYYY-MM-DD key for date-only equality (matches formatReportDate day). */
export function getUtcCalendarDayKey(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** UTC midnight ms for the calendar day of `date` (date-only → datetime promotion). */
export function getUtcMidnightMs(date: Date): number {
    return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    );
}

/** Parse an ISO `YYYY-MM-DD` date literal into a UTC Date, or null if invalid. */
export function parseIsoDateLiteral(value: string): Date | null {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

/** Parse a report date/datetime cell into a Date, or null if missing/invalid. */
export function parseReportDateValue(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number") {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const date = new Date(trimmed);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
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
