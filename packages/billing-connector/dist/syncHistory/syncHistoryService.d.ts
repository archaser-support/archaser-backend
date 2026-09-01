import type { ConnectorSyncRunSummary } from "../sync/connectorSyncRuntime";
import { createMemorySyncHistoryStore } from "./memoryStore";
import { defaultSinceDate, HEARTBEAT_INTERVAL_SECONDS, HISTORY_WINDOW_DAYS, STALE_RUNNING_HOURS } from "./store";
import type { CompleteExecutionInput, CreateRunningExecutionInput, DeferCompletionUntilPostIngestDrainInput, FinalizeAwaitingPostIngestDrainOptions, ListExecutionsOptions, MarkExecutionCancelledInput, SweepStaleRunningOptions, SyncHistoryExecution, TouchProgressInput } from "./types";
/** Swap to in-memory store for unit tests. */
export declare function useMemorySyncHistoryStoreForTests(): ReturnType<typeof createMemorySyncHistoryStore>;
export declare function resetSyncHistoryStoreForTests(): void;
export declare function createRunningExecution(input: CreateRunningExecutionInput): Promise<SyncHistoryExecution>;
/**
 * Finalize a run. Refuses to overwrite if the execution is no longer RUNNING
 * (e.g. Stop already marked TIMEOUT / cancelled).
 */
export declare function completeExecution(executionId: string, input: CompleteExecutionInput): Promise<SyncHistoryExecution | null>;
export declare function markExecutionCancelled(executionId: string, input?: MarkExecutionCancelledInput): Promise<SyncHistoryExecution | null>;
export declare function touchExecutionProgress(executionId: string, input?: TouchProgressInput): Promise<SyncHistoryExecution | null>;
export declare function deferExecutionCompletionUntilPostIngestDrain(executionId: string, input: DeferCompletionUntilPostIngestDrainInput): Promise<SyncHistoryExecution | null>;
export declare function listAwaitingPostIngestDrainExecutions(accountId?: number): Promise<SyncHistoryExecution[]>;
/**
 * Completes RUNNING executions that deferred terminal status until the worker
 * post-import drain queue is empty for their account.
 */
export declare function finalizeAwaitingPostIngestDrainExecutions(options?: FinalizeAwaitingPostIngestDrainOptions): Promise<number>;
export declare function listExecutionsForAccount(accountId: number, options?: ListExecutionsOptions): Promise<SyncHistoryExecution[]>;
export declare function listRunningSyncAccountIds(): Promise<number[]>;
export declare function sweepStaleRunning(options?: SweepStaleRunningOptions): Promise<number>;
/** Map Mongo history row → API / progress summary shape (`id` = execution_id). */
export declare function syncHistoryExecutionToSummary(doc: SyncHistoryExecution): ConnectorSyncRunSummary;
export { HEARTBEAT_INTERVAL_SECONDS, HISTORY_WINDOW_DAYS, STALE_RUNNING_HOURS, defaultSinceDate, };
export type { CompleteExecutionInput, CreateRunningExecutionInput, DeferCompletionUntilPostIngestDrainInput, FinalizeAwaitingPostIngestDrainOptions, ListExecutionsOptions, MarkExecutionCancelledInput, SweepStaleRunningOptions, SyncHistoryExecution, ConnectorExecutionStatus, ConnectorSyncTrigger, SyncHistoryEntityStats, TouchProgressInput, } from "./types";
