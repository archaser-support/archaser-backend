import type { ConnectorEntityStatSlice } from "../sync/connectorSyncRuntime";

export type ConnectorExecutionStatus =
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "PARTIAL"
    | "TIMEOUT";

export type ConnectorSyncTrigger =
    | "scheduled"
    | "manual"
    | "preview"
    | "backfill";

export type SyncHistoryEntityStats = Record<string, ConnectorEntityStatSlice>;

export interface SyncHistoryExecution {
    execution_id: string;
    connector_id: number;
    account_id: number;
    provider: string;
    trigger: ConnectorSyncTrigger;
    sync_mode: string;
    status: ConnectorExecutionStatus;
    started_at: Date;
    completed_at: Date | null;
    duration_seconds: number | null;
    entity_stats: SyncHistoryEntityStats;
    error_message: string | null;
    error_type: string | null;
}

export interface CreateRunningExecutionInput {
    executionId: string;
    accountId: number;
    connectorId: number;
    provider: string;
    trigger: ConnectorSyncTrigger;
    syncMode: string;
    startedAt?: Date;
}

export interface CompleteExecutionInput {
    status: Exclude<ConnectorExecutionStatus, "RUNNING">;
    entityStats?: SyncHistoryEntityStats;
    errorMessage?: string | null;
    errorType?: string | null;
    completedAt?: Date;
}

export interface MarkExecutionCancelledInput {
    errorMessage?: string;
    completedAt?: Date;
}

export interface ListExecutionsOptions {
    /** Inclusive lower bound; defaults to 90 days ago. */
    since?: Date;
    limit?: number;
}

export interface SweepStaleRunningOptions {
    olderThanHours?: number;
    accountId?: number;
    completedAt?: Date;
}
