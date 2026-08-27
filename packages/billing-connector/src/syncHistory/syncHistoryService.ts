import type { ConnectorSyncRunSummary } from "../sync/connectorSyncRuntime";
import { createMemorySyncHistoryStore } from "./memoryStore";
import { mongooseSyncHistoryStore } from "./mongooseStore";
import {
    defaultSinceDate,
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    type SyncHistoryStore,
} from "./store";
import type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
} from "./types";

let activeStore: SyncHistoryStore = mongooseSyncHistoryStore;
let memoryStoreForTests: ReturnType<typeof createMemorySyncHistoryStore> | null =
    null;

function store(): SyncHistoryStore {
    return activeStore;
}

/** Swap to in-memory store for unit tests. */
export function useMemorySyncHistoryStoreForTests(): ReturnType<
    typeof createMemorySyncHistoryStore
> {
    memoryStoreForTests = createMemorySyncHistoryStore();
    activeStore = memoryStoreForTests;
    return memoryStoreForTests;
}

export function resetSyncHistoryStoreForTests(): void {
    memoryStoreForTests?.reset();
    memoryStoreForTests = null;
    activeStore = mongooseSyncHistoryStore;
}

export async function createRunningExecution(
    input: CreateRunningExecutionInput
): Promise<SyncHistoryExecution> {
    return store().createRunning(input);
}

/**
 * Finalize a run. Refuses to overwrite if the execution is no longer RUNNING
 * (e.g. Stop already marked TIMEOUT / cancelled).
 */
export async function completeExecution(
    executionId: string,
    input: CompleteExecutionInput
): Promise<SyncHistoryExecution | null> {
    return store().completeIfRunning(executionId, input);
}

export async function markExecutionCancelled(
    executionId: string,
    input?: MarkExecutionCancelledInput
): Promise<SyncHistoryExecution | null> {
    return store().markCancelledIfRunning(executionId, input);
}

export async function listExecutionsForAccount(
    accountId: number,
    options?: ListExecutionsOptions
): Promise<SyncHistoryExecution[]> {
    return store().listForAccount(accountId, {
        since: options?.since ?? defaultSinceDate(),
        limit: options?.limit,
    });
}

export async function sweepStaleRunning(
    options?: SweepStaleRunningOptions
): Promise<number> {
    return store().sweepStaleRunning({
        olderThanHours: options?.olderThanHours ?? STALE_RUNNING_HOURS,
        accountId: options?.accountId,
        completedAt: options?.completedAt,
    });
}

/** Map Mongo history row → API / progress summary shape (`id` = execution_id). */
export function syncHistoryExecutionToSummary(
    doc: SyncHistoryExecution
): ConnectorSyncRunSummary {
    return {
        id: doc.execution_id,
        trigger: doc.trigger,
        sync_mode: doc.sync_mode,
        status: doc.status,
        started_at: doc.started_at.toISOString(),
        completed_at: doc.completed_at
            ? doc.completed_at.toISOString()
            : null,
        duration_seconds: doc.duration_seconds,
        entity_stats: doc.entity_stats ?? {},
        error_message: doc.error_message,
        error_type: doc.error_type,
        cutover_options: null,
        cutover_summary: null,
    };
}

export {
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    defaultSinceDate,
};

export type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
    ConnectorExecutionStatus,
    ConnectorSyncTrigger,
    SyncHistoryEntityStats,
} from "./types";
