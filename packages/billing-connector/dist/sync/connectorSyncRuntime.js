"use strict";
/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TAIL_STEP_KEYS = exports.BALANCES_ENTITY_STATS_KEY = exports.PENDING_CLOSES_ENTITY_STATS_KEY = exports.INSURANCE_TARGETS_ENTITY_STATS_KEY = exports.PROCESS_OVERDUE_ENTITY_STATS_KEY = exports.LIVE_REFRESH_ENTITY_STATS_KEY = exports.AR_REPLAY_ENTITY_STATS_KEY = exports.POST_INGEST_ENTITY_STATS_KEY = exports.PURGE_ENTITY_STATS_KEY = exports.MATURITY_ENTITY_STATS_KEY = void 0;
exports.entityStatsFromCounts = entityStatsFromCounts;
exports.registerRunningSync = registerRunningSync;
exports.getRunningSync = getRunningSync;
exports.clearRunningSync = clearRunningSync;
exports.upsertSyncRun = upsertSyncRun;
exports.patchSyncRunProgress = patchSyncRunProgress;
exports.patchSyncRunEntityStats = patchSyncRunEntityStats;
exports.listSyncRuns = listSyncRuns;
exports.resetConnectorSyncRuntimeForTests = resetConnectorSyncRuntimeForTests;
/** Orchestration step after Invoice — links deferred payments to invoices. */
exports.MATURITY_ENTITY_STATS_KEY = "_maturity";
/** Start backfill clear-before-import purge phase (before entity pull/import). */
exports.PURGE_ENTITY_STATS_KEY = "_purge";
/**
 * Tail steps after entity ingest. They run while the sync is still RUNNING, so
 * without their own stat keys the UI froze on the last entity row and gave no
 * reason for the disabled buttons.
 */
exports.POST_INGEST_ENTITY_STATS_KEY = "_post_ingest";
/** Chronological AR replay (limit_assessed_amount stamps). */
exports.AR_REPLAY_ENTITY_STATS_KEY = "_ar_replay";
/** Live MEP, capacity gap, and insurance field refresh. */
exports.LIVE_REFRESH_ENTITY_STATS_KEY = "_live_refresh";
exports.PROCESS_OVERDUE_ENTITY_STATS_KEY = "_process_overdue";
/** Refresh invoice insurance target reporting/MEP dates after ingest. */
exports.INSURANCE_TARGETS_ENTITY_STATS_KEY = "_insurance_targets";
exports.PENDING_CLOSES_ENTITY_STATS_KEY = "_pending_closes";
exports.BALANCES_ENTITY_STATS_KEY = "_balances";
exports.TAIL_STEP_KEYS = [
    exports.PENDING_CLOSES_ENTITY_STATS_KEY,
    exports.PROCESS_OVERDUE_ENTITY_STATS_KEY,
    exports.INSURANCE_TARGETS_ENTITY_STATS_KEY,
    exports.AR_REPLAY_ENTITY_STATS_KEY,
    exports.LIVE_REFRESH_ENTITY_STATS_KEY,
    exports.BALANCES_ENTITY_STATS_KEY,
];
function entityStatsFromCounts(stats) {
    const entityStats = {
        Customer: {
            pulled: stats.customersProcessed,
            success: stats.customersImported,
            failed: 0,
            skipped: 0,
            ...(stats.customersDeleted != null
                ? { deleted: stats.customersDeleted }
                : {}),
        },
        Contact: {
            pulled: stats.contactsProcessed,
            success: stats.contactsImported,
            failed: 0,
            skipped: 0,
            ...(stats.contactsDeleted != null
                ? { deleted: stats.contactsDeleted }
                : {}),
        },
        Invoice: {
            pulled: stats.invoicesProcessed,
            success: stats.invoicesImported,
            failed: 0,
            skipped: 0,
            ...(stats.invoicesDeleted != null
                ? { deleted: stats.invoicesDeleted }
                : {}),
        },
        Payment: {
            pulled: stats.paymentsProcessed,
            success: stats.paymentsImported,
            failed: 0,
            skipped: 0,
            ...(stats.paymentsDeleted != null
                ? { deleted: stats.paymentsDeleted }
                : {}),
        },
    };
    if (stats.purgeStatus) {
        const deletedTotal = (stats.customersDeleted ?? 0) +
            (stats.contactsDeleted ?? 0) +
            (stats.invoicesDeleted ?? 0) +
            (stats.paymentsDeleted ?? 0);
        const purgeTotal = stats.purgeTotal != null && stats.purgeTotal > 0
            ? stats.purgeTotal
            : deletedTotal;
        entityStats[exports.PURGE_ENTITY_STATS_KEY] = {
            // `pulled` = planned total (like link-payments); `success` = deleted so far.
            pulled: purgeTotal,
            success: deletedTotal,
            failed: 0,
            skipped: 0,
            status: stats.purgeStatus === "cancelled"
                ? "done"
                : stats.purgeStatus,
            detail: {
                step: stats.purgeDetail?.step ?? "deleting",
                processed: deletedTotal,
                total: purgeTotal,
            },
        };
    }
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
function isTerminalSyncRunSummary(run) {
    if (run.completed_at) {
        return true;
    }
    return (run.status === "SUCCESS" ||
        run.status === "FAILED" ||
        run.status === "PARTIAL" ||
        (run.status === "TIMEOUT" && run.error_type === "cancelled"));
}
/** Live progress must not clobber a cancelled / finished status. */
function patchSyncRunProgress(accountId, executionId, patch, fallback) {
    const existing = listSyncRuns(accountId).find((run) => run.id === executionId);
    if (existing && isTerminalSyncRunSummary(existing)) {
        return;
    }
    upsertSyncRun(accountId, {
        ...(existing ?? fallback),
        entity_stats: patch.entity_stats,
        ...(patch.active_step !== undefined
            ? { active_step: patch.active_step }
            : {}),
        ...(patch.active_step_detail !== undefined
            ? { active_step_detail: patch.active_step_detail }
            : {}),
    });
}
/** @deprecated Prefer patchSyncRunProgress when active_step is available. */
function patchSyncRunEntityStats(accountId, executionId, entityStats, fallback) {
    patchSyncRunProgress(accountId, executionId, { entity_stats: entityStats }, fallback);
}
function listSyncRuns(accountId, limit = 25) {
    const existing = historyByAccount.get(accountId) ?? [];
    return existing.slice(0, Math.max(1, Math.min(limit, MAX_HISTORY)));
}
function resetConnectorSyncRuntimeForTests() {
    runningByAccount.clear();
    historyByAccount.clear();
}
