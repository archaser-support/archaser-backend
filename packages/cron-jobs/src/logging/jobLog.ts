/**
 * Lightweight worker logging (replaces Nest Mongo LogService for cron paths).
 * Structured console lines; Loki/Mongo remain API-side if ingested from stdout.
 */
export function jobLog(
    source: string,
    level: "info" | "warn" | "error",
    message: string,
    data?: Record<string, unknown>
): void {
    const payload = {
        source,
        level,
        message,
        ...data,
        ts: new Date().toISOString(),
    };
    const line = `[cron-jobs:${source}] ${message}${
        data ? ` ${JSON.stringify(data)}` : ""
    }`;
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.info(line);
    }
    void payload;
}
