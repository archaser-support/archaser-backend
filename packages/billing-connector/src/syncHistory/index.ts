export { ensureMongoConnection } from "./mongooseConnection";
export {
    cleanupTwinRunningSyncExecutions,
    ensureAccountRunningUniqueIndex,
    ensureUniqueRunningSyncMutex,
    ensureUniqueRunningSyncMutexOnce,
    resetUniqueRunningSyncMutexEnsuredForTests,
    TWIN_RUNNING_CLEANUP_ERROR_MESSAGE,
    TWIN_RUNNING_CLEANUP_ERROR_TYPE,
    type CleanupTwinRunningResult,
    type EnsureUniqueRunningMutexResult,
} from "./ensureUniqueRunningMutex";
export {
    createRunningExecution,
    completeExecution,
    markExecutionCancelled,
    touchExecutionProgress,
    deferExecutionCompletionUntilPostIngestDrain,
    listAwaitingPostIngestDrainExecutions,
    finalizeAwaitingPostIngestDrainExecutions,
    listExecutionsForAccount,
    findLastSuccessfulExecutionForConnector,
    watermarkFromSuccessfulExecution,
    listRunningSyncAccountIds,
    sweepStaleRunning,
    syncHistoryExecutionToSummary,
    useMemorySyncHistoryStoreForTests,
    resetSyncHistoryStoreForTests,
    HEARTBEAT_INTERVAL_SECONDS,
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    defaultSinceDate,
    isSyncAlreadyRunningError,
    SyncAlreadyRunningError,
} from "./syncHistoryService";
export {
    createSyncProgressHeartbeat,
    touchAwaitingPostIngestDrainProgress,
} from "./syncProgressHeartbeat";
export { finalizeSyncHistoryAfterRun } from "./finalizeSyncHistoryAfterRun";
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
