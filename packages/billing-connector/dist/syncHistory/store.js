"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STALE_RUNNING_HOURS = exports.HISTORY_WINDOW_DAYS = exports.HEARTBEAT_INTERVAL_SECONDS = void 0;
exports.defaultSinceDate = defaultSinceDate;
exports.durationSecondsFrom = durationSecondsFrom;
exports.HEARTBEAT_INTERVAL_SECONDS = 60;
exports.HISTORY_WINDOW_DAYS = 90;
exports.STALE_RUNNING_HOURS = 2;
function defaultSinceDate(now = new Date()) {
    return new Date(now.getTime() - exports.HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
function durationSecondsFrom(startedAt, completedAt) {
    return Math.max(1, Math.round((completedAt.getTime() - startedAt.getTime()) / 1000));
}
