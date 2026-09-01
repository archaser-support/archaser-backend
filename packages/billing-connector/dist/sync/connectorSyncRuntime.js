"use strict";
/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAIL_STEP_KEYS = exports.BALANCES_ENTITY_STATS_KEY = exports.PENDING_CLOSES_ENTITY_STATS_KEY = exports.POST_INGEST_ENTITY_STATS_KEY = exports.MATURITY_ENTITY_STATS_KEY = void 0;
exports.entityStatsFromCounts = entityStatsFromCounts;
exports.registerRunningSync = registerRunningSync;
exports.getRunningSync = getRunningSync;
exports.clearRunningSync = clearRunningSync;
exports.upsertSyncRun = upsertSyncRun;
exports.patchSyncRunEntityStats = patchSyncRunEntityStats;
exports.listSyncRuns = listSyncRuns;
exports.resetConnectorSyncRuntimeForTests = resetConnectorSyncRuntimeForTests;
/** Orchestration step after Invoice — links deferred payments to invoices. */
exports.MATURITY_ENTITY_STATS_KEY = "_maturity";
/**
 * Tail steps after entity ingest. They run while the sync is still RUNNING, so
 * without their own stat keys the UI froze on the last entity row and gave no
 * reason for the disabled buttons.
 */
exports.POST_INGEST_ENTITY_STATS_KEY = "_post_ingest";
exports.PENDING_CLOSES_ENTITY_STATS_KEY = "_pending_closes";
exports.BALANCES_ENTITY_STATS_KEY = "_balances";
exports.TAIL_STEP_KEYS = [
    exports.POST_INGEST_ENTITY_STATS_KEY,
    exports.PENDING_CLOSES_ENTITY_STATS_KEY,
    exports.BALANCES_ENTITY_STATS_KEY,
];
function entityStatsFromCounts(stats) {
    const sliceFor = (key) => {
        const accum = stats.entityImportStats?.[key];
        return {
            failed: accum?.failed ?? 0,
            skipped: accum?.skipped ?? 0,
            mandatoryFieldSkips: accum?.mandatoryFieldSkips,
            sample_errors: accum?.sample_errors && accum.sample_errors.length > 0
                ? accum.sample_errors
                : undefined,
        };
    };
    const entityStats = {
        Customer: {
            pulled: stats.customersProcessed,
            success: stats.customersImported,
            ...sliceFor("Customer"),
        },
        Contact: {
            pulled: stats.contactsProcessed,
            success: stats.contactsImported,
            ...sliceFor("Contact"),
        },
        Invoice: {
            pulled: stats.invoicesProcessed,
            success: stats.invoicesImported,
            ...sliceFor("Invoice"),
        },
        Payment: {
            pulled: stats.paymentsProcessed,
            success: stats.paymentsImported,
            ...sliceFor("Payment"),
        },
    };
    if (stats.paymentLinkStatus) {
        const linked = stats.paymentsLinked ?? 0;
        const deferred = stats.paymentsStillDeferred ?? 0;
        const total = stats.paymentsLinkTotal ??
            (linked + deferred > 0 ? linked + deferred : linked);
        entityStats[exports.MATURITY_ENTITY_STATS_KEY] = {
            pulled: total,
            success: linked,
            failed: stats.paymentLinkStatus === "failed" ? 1 : 0,
            skipped: Math.max(0, total - linked),
            status: stats.paymentLinkStatus,
            ...(stats.paymentLinkDetail
                ? { detail: stats.paymentLinkDetail }
                : {}),
            ...(stats.paymentLinkError
                ? { sample_errors: [stats.paymentLinkError] }
                : {}),
        };
    }
    for (const key of exports.TAIL_STEP_KEYS) {
        const step = stats.tailSteps?.[key];
        if (!step) {
            continue;
        }
        const processed = step.processed ?? 0;
        const total = step.total ?? processed;
        entityStats[key] = {
            pulled: total,
            success: step.status === "done" ? total : processed,
            failed: step.status === "failed" ? 1 : 0,
            skipped: 0,
            status: step.status,
            ...(step.detail ? { detail: step.detail } : {}),
            ...(step.error ? { sample_errors: [step.error] } : {}),
        };
    }
    return entityStats;
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
