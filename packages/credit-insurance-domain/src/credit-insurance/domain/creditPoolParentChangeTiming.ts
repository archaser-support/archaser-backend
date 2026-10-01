export function elapsedMsSince(startedMs: number): number {
    return Date.now() - startedMs;
}

/** Inclusive UTC calendar days between two dates (for CTP/CDP range sizing). */
export function inclusiveUtcDaySpan(fromDate: Date, toDate: Date): number {
    const from = Date.UTC(
        fromDate.getUTCFullYear(),
        fromDate.getUTCMonth(),
        fromDate.getUTCDate()
    );
    const to = Date.UTC(
        toDate.getUTCFullYear(),
        toDate.getUTCMonth(),
        toDate.getUTCDate()
    );
    if (to < from) {
        return 0;
    }
    return Math.round((to - from) / 86_400_000) + 1;
}
