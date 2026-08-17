"use strict";
/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRunningSync = registerRunningSync;
exports.getRunningSync = getRunningSync;
exports.clearRunningSync = clearRunningSync;
exports.upsertSyncRun = upsertSyncRun;
exports.listSyncRuns = listSyncRuns;
exports.resetConnectorSyncRuntimeForTests = resetConnectorSyncRuntimeForTests;
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
function listSyncRuns(accountId, limit = 25) {
    const existing = historyByAccount.get(accountId) ?? [];
    return existing.slice(0, Math.max(1, Math.min(limit, MAX_HISTORY)));
}
function resetConnectorSyncRuntimeForTests() {
    runningByAccount.clear();
    historyByAccount.clear();
}
