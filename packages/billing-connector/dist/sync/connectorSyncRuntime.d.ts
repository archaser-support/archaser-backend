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
    entity_stats: Record<string, {
        pulled: number;
        success: number;
        failed: number;
        skipped: number;
    }>;
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
