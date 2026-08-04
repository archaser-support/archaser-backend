/**
 * Lightweight worker logging (replaces Nest Mongo LogService for cron paths).
 * Structured console lines; Loki/Mongo remain API-side if ingested from stdout.
 */
export declare function jobLog(source: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void;
