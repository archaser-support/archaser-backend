/**
 * In-process registry of the connector sync currently running in this process,
 * plus a short history of completed runs for GET /sync-runs polling.
 */

export interface ConnectorSyncRunSummary {
    id: string;
    trigger: string;
    sync_mode: string;
    status: string;
    started_at: string;
    completed_at: string | null;
    duration_seconds: number | null;
    entity_stats: Record<
        string,
        { pulled: number; success: number; failed: number; skipped: number }
    >;
    error_message: string | null;
    error_type: string | null;
    cutover_options?: {
        backfill_start_date: string | null;
        include_older_open_invoices: boolean;
        skip_reporting_breach_on_backfill: boolean;
    } | null;
    cutover_summary?: string | null;
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
