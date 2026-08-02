"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatReportDateTime = formatReportDateTime;
function formatReportDateTime(date, locale, timezone) {
    const options = {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: locale !== "he-IL",
        ...(timezone ? { timeZone: timezone } : {}),
    };
    return date.toLocaleString(locale, options);
}
//# sourceMappingURL=report-datetime.util.js.map