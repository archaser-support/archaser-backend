"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSinceDate = exports.STALE_RUNNING_HOURS = exports.HISTORY_WINDOW_DAYS = void 0;
exports.useMemorySyncHistoryStoreForTests = useMemorySyncHistoryStoreForTests;
exports.resetSyncHistoryStoreForTests = resetSyncHistoryStoreForTests;
exports.createRunningExecution = createRunningExecution;
exports.completeExecution = completeExecution;
exports.markExecutionCancelled = markExecutionCancelled;
exports.listExecutionsForAccount = listExecutionsForAccount;
exports.sweepStaleRunning = sweepStaleRunning;
exports.syncHistoryExecutionToSummary = syncHistoryExecutionToSummary;
const memoryStore_1 = require("./memoryStore");
const mongooseStore_1 = require("./mongooseStore");
const store_1 = require("./store");
Object.defineProperty(exports, "defaultSinceDate", { enumerable: true, get: function () { return store_1.defaultSinceDate; } });
Object.defineProperty(exports, "HISTORY_WINDOW_DAYS", { enumerable: true, get: function () { return store_1.HISTORY_WINDOW_DAYS; } });
Object.defineProperty(exports, "STALE_RUNNING_HOURS", { enumerable: true, get: function () { return store_1.STALE_RUNNING_HOURS; } });
let activeStore = mongooseStore_1.mongooseSyncHistoryStore;
let memoryStoreForTests = null;
function store() {
    return activeStore;
}
/** Swap to in-memory store for unit tests. */
function useMemorySyncHistoryStoreForTests() {
    memoryStoreForTests = (0, memoryStore_1.createMemorySyncHistoryStore)();
    activeStore = memoryStoreForTests;
    return memoryStoreForTests;
}
function resetSyncHistoryStoreForTests() {
    memoryStoreForTests?.reset();
    memoryStoreForTests = null;
    activeStore = mongooseStore_1.mongooseSyncHistoryStore;
}
async function createRunningExecution(input) {
    return store().createRunning(input);
}
/**
 * Finalize a run. Refuses to overwrite if the execution is no longer RUNNING
 * (e.g. Stop already marked TIMEOUT / cancelled).
 */
async function completeExecution(executionId, input) {
    return store().completeIfRunning(executionId, input);
}
async function markExecutionCancelled(executionId, input) {
    return store().markCancelledIfRunning(executionId, input);
}
async function listExecutionsForAccount(accountId, options) {
    return store().listForAccount(accountId, {
        since: options?.since ?? (0, store_1.defaultSinceDate)(),
        limit: options?.limit,
    });
}
async function sweepStaleRunning(options) {
    return store().sweepStaleRunning({
        olderThanHours: options?.olderThanHours ?? store_1.STALE_RUNNING_HOURS,
        accountId: options?.accountId,
        completedAt: options?.completedAt,
    });
}
/** Map Mongo history row → API / progress summary shape (`id` = execution_id). */
function syncHistoryExecutionToSummary(doc) {
    return {
        id: doc.execution_id,
        trigger: doc.trigger,
        sync_mode: doc.sync_mode,
        status: doc.status,
        started_at: doc.started_at.toISOString(),
        completed_at: doc.completed_at
            ? doc.completed_at.toISOString()
            : null,
        duration_seconds: doc.duration_seconds,
        entity_stats: doc.entity_stats ?? {},
        error_message: doc.error_message,
        error_type: doc.error_type,
        cutover_options: null,
        cutover_summary: null,
    };
}
