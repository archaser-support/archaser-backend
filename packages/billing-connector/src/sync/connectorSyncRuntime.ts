/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */

/** Orchestration step after Invoice — links deferred payments to invoices. */
export const MATURITY_ENTITY_STATS_KEY = "_maturity";

export type ConnectorEntityStatSlice = {
    pulled: number;
    success: number;
    failed: number;
    skipped: number;
    sample_errors?: string[];
    /** Present for `_maturity` while linking / after it finishes. */
    status?: "running" | "done" | "failed";
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
    /** Deferred payment → invoice linking (after Invoice ingest). */
    paymentLinkStatus?: "running" | "done" | "failed";
    paymentsLinked?: number;
    paymentsStillDeferred?: number;
    /** Eligible deferred payments at the start of the linking pass. */
    paymentsLinkTotal?: number;
    paymentLinkError?: string;
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
            ...(stats.paymentLinkError
                ? { sample_errors: [stats.paymentLinkError] }
                : {}),
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

/** Live progress must not clobber a cancelled / finished status. */
export function patchSyncRunEntityStats(
    accountId: number,
    executionId: string,
    entityStats: ConnectorEntityStats,
    fallback: ConnectorSyncRunSummary
): void {
    const existing = listSyncRuns(accountId).find(
        (run) => run.id === executionId
    );
    upsertSyncRun(accountId, {
        ...(existing ?? fallback),
        entity_stats: entityStats,
    });
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
