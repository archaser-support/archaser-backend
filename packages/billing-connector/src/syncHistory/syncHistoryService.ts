import type { ConnectorSyncRunSummary } from "../sync/connectorSyncRuntime";
import { createMemorySyncHistoryStore } from "./memoryStore";
import { mongooseSyncHistoryStore } from "./mongooseStore";
import { applyPostIngestDrainProgressToEntityStats } from "./postIngestDrainEntityStats";
import {
    defaultSinceDate,
    HEARTBEAT_INTERVAL_SECONDS,
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    type SyncHistoryStore,
} from "./store";
import type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    DeferCompletionUntilPostIngestDrainInput,
    FinalizeAwaitingPostIngestDrainOptions,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
    TouchProgressInput,
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

export async function touchExecutionProgress(
    executionId: string,
    input?: TouchProgressInput
): Promise<SyncHistoryExecution | null> {
    return store().touchProgressIfRunning(executionId, input);
}

export async function deferExecutionCompletionUntilPostIngestDrain(
    executionId: string,
    input: DeferCompletionUntilPostIngestDrainInput
): Promise<SyncHistoryExecution | null> {
    return store().deferCompletionUntilPostIngestDrain(executionId, input);
}

export async function listAwaitingPostIngestDrainExecutions(
    accountId?: number
): Promise<SyncHistoryExecution[]> {
    return store().listAwaitingPostIngestDrainExecutions(accountId);
}

/**
 * Completes RUNNING executions that deferred terminal status until the worker
 * post-import drain queue is empty for their account.
 */
export async function finalizeAwaitingPostIngestDrainExecutions(
    options?: FinalizeAwaitingPostIngestDrainOptions
): Promise<number> {
    const awaiting = await store().listAwaitingPostIngestDrainExecutions(
        options?.accountId
    );
    if (awaiting.length === 0) {
        return 0;
    }

    let completed = 0;
    for (const execution of awaiting) {
        if (!options?.countPendingForAccount) {
            continue;
        }
        const pending = await options.countPendingForAccount(
            execution.account_id
        );
        if (pending > 0) {
            continue;
        }
        const pendingStatus = execution.pending_terminal_status;
        if (!pendingStatus) {
            continue;
        }
        const finalized = await store().completeIfRunning(
            execution.execution_id,
            {
                status: pendingStatus,
                entityStats: applyPostIngestDrainProgressToEntityStats(
                    execution.entity_stats,
                    0
                ),
                errorMessage: execution.pending_error_message ?? null,
                errorType: execution.pending_error_type ?? null,
            }
        );
        if (finalized) {
            completed += 1;
        }
    }
    return completed;
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

export async function listRunningSyncAccountIds(): Promise<number[]> {
    return store().listRunningAccountIds();
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
    HEARTBEAT_INTERVAL_SECONDS,
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    defaultSinceDate,
};

export type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    DeferCompletionUntilPostIngestDrainInput,
    FinalizeAwaitingPostIngestDrainOptions,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
    ConnectorExecutionStatus,
    ConnectorSyncTrigger,
    SyncHistoryEntityStats,
    TouchProgressInput,
} from "./types";
