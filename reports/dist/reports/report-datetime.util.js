"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatReportDateTime = formatReportDateTime;
/**
 * Format a report datetime for display.
 * Aligns with frontend `formatDateForDisplay` (locale for pattern, IANA timezone for clock).
 */
function formatReportDateTime(date, locale, timezone) {
    const options = {
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
