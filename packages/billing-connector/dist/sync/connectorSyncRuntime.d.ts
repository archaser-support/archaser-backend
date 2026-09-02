/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */
/** Orchestration step after Invoice — links deferred payments to invoices. */
export declare const MATURITY_ENTITY_STATS_KEY = "_maturity";
/** Start backfill clear-before-import purge phase (before entity pull/import). */
export declare const PURGE_ENTITY_STATS_KEY = "_purge";
/**
 * Tail steps after entity ingest. They run while the sync is still RUNNING, so
 * without their own stat keys the UI froze on the last entity row and gave no
 * reason for the disabled buttons.
 */
export declare const POST_INGEST_ENTITY_STATS_KEY = "_post_ingest";
/** Chronological AR replay (limit_assessed_amount stamps). */
export declare const AR_REPLAY_ENTITY_STATS_KEY = "_ar_replay";
/** Live MEP, capacity gap, and insurance field refresh. */
export declare const LIVE_REFRESH_ENTITY_STATS_KEY = "_live_refresh";
export declare const PROCESS_OVERDUE_ENTITY_STATS_KEY = "_process_overdue";
export declare const PENDING_CLOSES_ENTITY_STATS_KEY = "_pending_closes";
export declare const BALANCES_ENTITY_STATS_KEY = "_balances";
export declare const TAIL_STEP_KEYS: readonly ["_pending_closes", "_process_overdue", "_ar_replay", "_live_refresh", "_balances"];
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
export interface ConnectorSyncRunSummary {
    id: string;
    trigger: string;
    sync_mode: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_seconds: number | null;
    entity_stats: Record<string, ConnectorEntityStatSlice>;
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
    entityImportStats?: Partial<Record<string, import("../import/aggregateEntityImportStats").EntityImportStatsAccum>>;
}
export declare function entityStatsFromCounts(stats: ConnectorSyncCounts): ConnectorEntityStats;
export interface RunningConnectorSync {
    accountId: number;
    executionId: string;
    startedAt: Date;
    mode: "backfill" | "incremental";
    trigger: string;
}
export declare function registerRunningSync(run: RunningConnectorSync): void;
export declare function getRunningSync(accountId: number): RunningConnectorSync | undefined;
export declare function clearRunningSync(accountId: number): void;
export declare function upsertSyncRun(accountId: number, summary: ConnectorSyncRunSummary): void;
/** Live progress must not clobber a cancelled / finished status. */
export declare function patchSyncRunEntityStats(accountId: number, executionId: string, entityStats: ConnectorEntityStats, fallback: ConnectorSyncRunSummary): void;
export declare function listSyncRuns(accountId: number, limit?: number): ConnectorSyncRunSummary[];
export declare function resetConnectorSyncRuntimeForTests(): void;
