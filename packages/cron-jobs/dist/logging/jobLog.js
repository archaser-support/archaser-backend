"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobLog = jobLog;
/**
 * Lightweight worker logging (replaces Nest Mongo LogService for cron paths).
 * Structured console lines; Loki/Mongo remain API-side if ingested from stdout.
 */
function jobLog(source, level, message, data) {
    const payload = {
        source,
        level,
        message,
        ...data,
        ts: new Date().toISOString(),
    };
    const line = `[cron-jobs:${source}] ${message}${data ? ` ${JSON.stringify(data)}` : ""}`;
    if (level === "error") {
        console.error(line);
    }
    else if (level === "warn") {
        console.warn(line);
    }
    else {
        console.info(line);
    }
    void payload;
}
