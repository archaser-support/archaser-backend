import type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
} from "./types";

export interface SyncHistoryStore {
    createRunning(
        input: CreateRunningExecutionInput
    ): Promise<SyncHistoryExecution>;
    /**
     * Transitions RUNNING → terminal. Returns null when already cancelled /
     * timed out / otherwise non-RUNNING (cancel guard).
     */
    completeIfRunning(
        executionId: string,
        input: CompleteExecutionInput
    ): Promise<SyncHistoryExecution | null>;
    /**
     * Transitions RUNNING → TIMEOUT (cancelled). No-op if not RUNNING.
     */
    markCancelledIfRunning(
        executionId: string,
        input?: MarkExecutionCancelledInput
    ): Promise<SyncHistoryExecution | null>;
    listForAccount(
        accountId: number,
        options?: ListExecutionsOptions
    ): Promise<SyncHistoryExecution[]>;
    sweepStaleRunning(options?: SweepStaleRunningOptions): Promise<number>;
}

export const HISTORY_WINDOW_DAYS = 90;
export const STALE_RUNNING_HOURS = 2;

export function defaultSinceDate(now = new Date()): Date {
    return new Date(
        now.getTime() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    );
}

export function durationSecondsFrom(startedAt: Date, completedAt: Date): number {
    return Math.max(
        1,
        Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
    );
}
