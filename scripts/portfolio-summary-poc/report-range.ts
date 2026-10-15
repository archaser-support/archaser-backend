/** Inclusive report window: the last 180 calendar days, ending today. */
export const REPORT_RANGE_DAYS = 180;

function ymd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function lastReportRange(now: Date = new Date()): {
    from: string;
    to: string;
} {
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(to);
    from.setDate(from.getDate() - (REPORT_RANGE_DAYS - 1));
    return { from: ymd(from), to: ymd(to) };
}
