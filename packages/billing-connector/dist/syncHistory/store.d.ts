import type { CompleteExecutionInput, CreateRunningExecutionInput, DeferCompletionUntilPostIngestDrainInput, ListExecutionsOptions, MarkExecutionCancelledInput, SweepStaleRunningOptions, SyncHistoryExecution, TouchProgressInput } from "./types";
export interface SyncHistoryStore {
    createRunning(input: CreateRunningExecutionInput): Promise<SyncHistoryExecution>;
    /**
     * Transitions RUNNING → terminal. Returns null when already cancelled /
     * timed out / otherwise non-RUNNING (cancel guard).
     */
    completeIfRunning(executionId: string, input: CompleteExecutionInput): Promise<SyncHistoryExecution | null>;
    /**
     * Transitions RUNNING → TIMEOUT (cancelled). No-op if not RUNNING.
     */
    markCancelledIfRunning(executionId: string, input?: MarkExecutionCancelledInput): Promise<SyncHistoryExecution | null>;
    listForAccount(accountId: number, options?: ListExecutionsOptions): Promise<SyncHistoryExecution[]>;
    /** Distinct account IDs with at least one RUNNING execution. */
    listRunningAccountIds(): Promise<number[]>;
    /** Updates last_progress_at (and optional entity_stats) while RUNNING. */
    touchProgressIfRunning(executionId: string, input?: TouchProgressInput): Promise<SyncHistoryExecution | null>;
    /**
     * Keep RUNNING until deferred post-import drain completes; stores pending
     * terminal status for finalizeAwaitingPostIngestDrainExecutions.
     */
    deferCompletionUntilPostIngestDrain(executionId: string, input: DeferCompletionUntilPostIngestDrainInput): Promise<SyncHistoryExecution | null>;
    /** RUNNING executions waiting on deferred post-import drain. */
    listAwaitingPostIngestDrainExecutions(accountId?: number): Promise<SyncHistoryExecution[]>;
    sweepStaleRunning(options?: SweepStaleRunningOptions): Promise<number>;
}
export declare const HEARTBEAT_INTERVAL_SECONDS = 60;
export declare const HISTORY_WINDOW_DAYS = 90;
export declare const STALE_RUNNING_HOURS = 2;
export declare function defaultSinceDate(now?: Date): Date;
export declare function durationSecondsFrom(startedAt: Date, completedAt: Date): number;
