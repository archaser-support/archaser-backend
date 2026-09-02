import {
    completeExecution,
    deferExecutionCompletionUntilPostIngestDrain,
} from "../syncHistory";
import {
    resolveSyncErrorType,
    resolveSyncExecutionStatus,
} from "../observability/statusAndErrorType";
import type { RunInProcessSyncResult } from "../sync/runInProcessSync";

/**
 * Persist terminal Mongo sync history after in-process sync finishes.
 * When post-import was deferred to the worker drain, keep RUNNING until
 * finalizeAwaitingPostIngestDrainExecutions completes the row.
 */
import type { ConnectorExecutionStatus } from "./types";

type TerminalExecutionStatus = Exclude<
    ConnectorExecutionStatus,
    "RUNNING"
>;

export async function finalizeSyncHistoryAfterRun(
    executionId: string,
    result: RunInProcessSyncResult,
    completedAt = new Date()
): Promise<void> {
    const status = resolveSyncExecutionStatus(result) as TerminalExecutionStatus;
    const errorType = resolveSyncErrorType(result, status);

    if (result.postIngestDeferred) {
        await deferExecutionCompletionUntilPostIngestDrain(executionId, {
            pendingStatus: status,
            entityStats: result.entity_stats ?? {},
            errorMessage: result.error ?? null,
            errorType,
            progressAt: completedAt,
        });
        return;
    }

    await completeExecution(executionId, {
        status,
        entityStats: result.entity_stats ?? {},
        errorMessage: result.error ?? null,
        errorType,
        completedAt,
    });
}
