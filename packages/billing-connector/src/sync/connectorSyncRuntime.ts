/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */

/** Orchestration step after Invoice — links deferred payments to invoices. */
export const MATURITY_ENTITY_STATS_KEY = "_maturity";

/** Start backfill clear-before-import purge phase (before entity pull/import). */
export const PURGE_ENTITY_STATS_KEY = "_purge";

/**
 * Tail steps after entity ingest. They run while the sync is still RUNNING, so
 * without their own stat keys the UI froze on the last entity row and gave no
 * reason for the disabled buttons.
 */
export const POST_INGEST_ENTITY_STATS_KEY = "_post_ingest";
/** Chronological AR replay (limit_assessed_amount stamps). */
export const AR_REPLAY_ENTITY_STATS_KEY = "_ar_replay";
/** Live MEP, capacity gap, and insurance field refresh. */
export const LIVE_REFRESH_ENTITY_STATS_KEY = "_live_refresh";
export const PROCESS_OVERDUE_ENTITY_STATS_KEY = "_process_overdue";
/** Refresh invoice insurance target reporting/MEP dates after ingest. */
export const INSURANCE_TARGETS_ENTITY_STATS_KEY = "_insurance_targets";
export const PENDING_CLOSES_ENTITY_STATS_KEY = "_pending_closes";
export const BALANCES_ENTITY_STATS_KEY = "_balances";

export const TAIL_STEP_KEYS = [
    PENDING_CLOSES_ENTITY_STATS_KEY,
    PROCESS_OVERDUE_ENTITY_STATS_KEY,
    INSURANCE_TARGETS_ENTITY_STATS_KEY,
    AR_REPLAY_ENTITY_STATS_KEY,
    LIVE_REFRESH_ENTITY_STATS_KEY,
    BALANCES_ENTITY_STATS_KEY,
] as const;

export type TailStepKey = (typeof TAIL_STEP_KEYS)[number];

export type TailStepState = {
    status: "running" | "done" | "failed" | "queued";
    /** Customers / rows handled, when the step can count them. */
    processed?: number;
    total?: number;
    error?: string;
    /** What the step is doing right now, for a sub-line under the bar. */
    detail?: TailStepDetail;
};

export type TailStepDetail = {
    /** Machine key; the UI owns the wording. */
    step: string;
    processed?: number;
    total?: number;
};

export type ConnectorEntityStatSlice = {
    pulled: number;
    success: number;
    failed: number;
    skipped: number;
    /** Rows removed during Start backfill clear-before-import purge. */
    deleted?: number;
    sample_errors?: string[];
    /** Present for `_maturity` while linking / after it finishes. */
    status?: "running" | "done" | "failed" | "queued";
    /** Present for tail steps while running. */
    detail?: TailStepDetail;
};

/** Live progress patch — entity counters plus orchestrator pointer. */
export type ConnectorSyncProgressPatch = {
    entity_stats: ConnectorEntityStats;
    active_step?: string | null;
    active_step_detail?: string | null;
};

export interface ConnectorSyncRunSummary {
    id: string;
    trigger: string;
    sync_mode: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_seconds: number | null;
    entity_stats: Record<string, ConnectorEntityStatSlice>;
    /** Registry key for the step currently executing (Customer, _maturity, …). */
    active_step?: string | null;
    /** Sub-phase within the active step (pulling, linking, …). */
    active_step_detail?: string | null;
    error_message: string | null;
    error_type: string | null;
    cutover_options?: {
        backfill_start_date: string | null;
        mep_breach_start_date?: string | null;
        include_older_open_invoices: boolean;
        skip_reporting_breach_on_backfill: boolean;
    } | null;
    cutover_summary?: string | null;
}

export type ConnectorEntityStats = ConnectorSyncRunSummary["entity_stats"];

export interface ConnectorSyncCounts {
    customersProcessed: number;
    contactsProcessed: number;
    invoicesProcessed: number;
    paymentsProcessed: number;
    customersImported: number;
    contactsImported: number;
    invoicesImported: number;
    paymentsImported: number;
    importErrors: number;
    /** Clear-before-import purge counts (Start backfill only). */
    customersDeleted?: number;
    contactsDeleted?: number;
    invoicesDeleted?: number;
    paymentsDeleted?: number;
    /** Rows to delete at purge start (for determinate Deleting… progress). */
    purgeTotal?: number;
    /** Clear-before-import purge phase (Start backfill only). */
    purgeStatus?: "running" | "done" | "cancelled";
    /** Which entity is being purged right now (for progress detail). */
    purgeDetail?: TailStepDetail;
    /** Deferred payment → invoice linking (after Invoice ingest). */
    paymentLinkStatus?: "running" | "done" | "failed";
    paymentsLinked?: number;
    paymentsStillDeferred?: number;
    /** Eligible deferred payments at the start of the linking pass. */
    paymentsLinkTotal?: number;
    paymentLinkError?: string;
    /** What the linking pass is doing now (linking, aligning, recalculating). */
    paymentLinkDetail?: TailStepDetail;
    /** Tail steps (pending closes, process overdue, AR post-ingest, balances). */
    tailSteps?: Partial<Record<TailStepKey, TailStepState>>;
    /** Live-sync rows skipped for missing mandatory fields (Invoice/Payment). */
    mandatoryFieldSkips?: number;
    /** Per-entity import failures/skips with capped sample_errors. */
    entityImportStats?: Partial<
        Record<
            string,
            import("../import/aggregateEntityImportStats").EntityImportStatsAccum
        >
    >;
}

export function entityStatsFromCounts(
    stats: ConnectorSyncCounts
): ConnectorEntityStats {
    const entityStats: ConnectorEntityStats = {
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
        const deletedTotal =
            (stats.customersDeleted ?? 0) +
            (stats.contactsDeleted ?? 0) +
            (stats.invoicesDeleted ?? 0) +
            (stats.paymentsDeleted ?? 0);
        const purgeTotal =
            stats.purgeTotal != null && stats.purgeTotal > 0
                ? stats.purgeTotal
                : deletedTotal;
        entityStats[PURGE_ENTITY_STATS_KEY] = {
            // `pulled` = planned total (like link-payments); `success` = deleted so far.
            pulled: purgeTotal,
            success: deletedTotal,
            failed: 0,
            skipped: 0,
            status:
                stats.purgeStatus === "cancelled"
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
        const total =
            stats.paymentsLinkTotal ??
            (linked + deferred > 0 ? linked + deferred : linked);
        entityStats[MATURITY_ENTITY_STATS_KEY] = {
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

    for (const key of TAIL_STEP_KEYS) {
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

export interface RunningConnectorSync {
    accountId: number;
    executionId: string;
    startedAt: Date;
    mode: "backfill" | "incremental";
    trigger: string;
}

const runningByAccount = new Map<number, RunningConnectorSync>();
const historyByAccount = new Map<number, ConnectorSyncRunSummary[]>();

const MAX_HISTORY = 25;

export function registerRunningSync(run: RunningConnectorSync): void {
    runningByAccount.set(run.accountId, run);
}

export function getRunningSync(
    accountId: number
): RunningConnectorSync | undefined {
    return runningByAccount.get(accountId);
}

export function clearRunningSync(accountId: number): void {
    runningByAccount.delete(accountId);
}

export function upsertSyncRun(
    accountId: number,
    summary: ConnectorSyncRunSummary
): void {
    const existing = historyByAccount.get(accountId) ?? [];
    const next = existing.filter((run) => run.id !== summary.id);
    next.unshift(summary);
    historyByAccount.set(accountId, next.slice(0, MAX_HISTORY));
}

function isTerminalSyncRunSummary(run: ConnectorSyncRunSummary): boolean {
    if (run.completed_at) {
        return true;
    }
    return (
        run.status === "SUCCESS" ||
        run.status === "FAILED" ||
        run.status === "PARTIAL" ||
        (run.status === "TIMEOUT" && run.error_type === "cancelled")
    );
}

/** Live progress must not clobber a cancelled / finished status. */
export function patchSyncRunProgress(
    accountId: number,
    executionId: string,
    patch: ConnectorSyncProgressPatch,
    fallback: ConnectorSyncRunSummary
): void {
    const existing = listSyncRuns(accountId).find(
        (run) => run.id === executionId
    );
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
export function patchSyncRunEntityStats(
    accountId: number,
    executionId: string,
    entityStats: ConnectorEntityStats,
    fallback: ConnectorSyncRunSummary
): void {
    patchSyncRunProgress(
        accountId,
        executionId,
        { entity_stats: entityStats },
        fallback
    );
}

export function listSyncRuns(
    accountId: number,
    limit = 25
): ConnectorSyncRunSummary[] {
    const existing = historyByAccount.get(accountId) ?? [];
    return existing.slice(0, Math.max(1, Math.min(limit, MAX_HISTORY)));
}

export function resetConnectorSyncRuntimeForTests(): void {
    runningByAccount.clear();
    historyByAccount.clear();
}
