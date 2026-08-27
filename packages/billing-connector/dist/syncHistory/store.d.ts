import type { CompleteExecutionInput, CreateRunningExecutionInput, ListExecutionsOptions, MarkExecutionCancelledInput, SweepStaleRunningOptions, SyncHistoryExecution } from "./types";
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
    sweepStaleRunning(options?: SweepStaleRunningOptions): Promise<number>;
}
export declare const HISTORY_WINDOW_DAYS = 90;
export declare const STALE_RUNNING_HOURS = 2;
export declare function defaultSinceDate(now?: Date): Date;
export declare function durationSecondsFrom(startedAt: Date, completedAt: Date): number;
