"use strict";
/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.entityStatsFromCounts = entityStatsFromCounts;
exports.registerRunningSync = registerRunningSync;
exports.getRunningSync = getRunningSync;
exports.clearRunningSync = clearRunningSync;
exports.upsertSyncRun = upsertSyncRun;
exports.patchSyncRunEntityStats = patchSyncRunEntityStats;
exports.listSyncRuns = listSyncRuns;
exports.resetConnectorSyncRuntimeForTests = resetConnectorSyncRuntimeForTests;
function entityStatsFromCounts(stats) {
    return {
        Customer: {
            pulled: stats.customersProcessed,
            success: stats.customersImported,
            failed: 0,
            skipped: 0,
        },
        Contact: {
            pulled: stats.contactsProcessed,
            success: stats.contactsImported,
            failed: 0,
            skipped: 0,
        },
        Invoice: {
            pulled: stats.invoicesProcessed,
            success: stats.invoicesImported,
            failed: 0,
            skipped: 0,
        },
        Payment: {
            pulled: stats.paymentsProcessed,
            success: stats.paymentsImported,
            failed: 0,
            skipped: 0,
        },
    };
}
const runningByAccount = new Map();
const historyByAccount = new Map();
const MAX_HISTORY = 25;
function registerRunningSync(run) {
    runningByAccount.set(run.accountId, run);
}
function getRunningSync(accountId) {
    return runningByAccount.get(accountId);
}
function clearRunningSync(accountId) {
    runningByAccount.delete(accountId);
}
function upsertSyncRun(accountId, summary) {
    const existing = historyByAccount.get(accountId) ?? [];
    const next = existing.filter((run) => run.id !== summary.id);
    next.unshift(summary);
    historyByAccount.set(accountId, next.slice(0, MAX_HISTORY));
}
/** Live progress must not clobber a cancelled / finished status. */
function patchSyncRunEntityStats(accountId, executionId, entityStats, fallback) {
    const existing = listSyncRuns(accountId).find((run) => run.id === executionId);
    upsertSyncRun(accountId, {
        ...(existing ?? fallback),
        entity_stats: entityStats,
    });
}
function listSyncRuns(accountId, limit = 25) {
    const existing = historyByAccount.get(accountId) ?? [];
    return existing.slice(0, Math.max(1, Math.min(limit, MAX_HISTORY)));
}
function resetConnectorSyncRuntimeForTests() {
    runningByAccount.clear();
    historyByAccount.clear();
}
