import type { SyncHistoryEntityStats } from "./types";
import { HEARTBEAT_INTERVAL_SECONDS } from "./store";
import { applyPostIngestDrainProgressToEntityStats } from "./postIngestDrainEntityStats";
import {
    listAwaitingPostIngestDrainExecutions,
    touchExecutionProgress,
} from "./syncHistoryService";
import { requestConnectorSyncCancel } from "../sync/connectorSyncCancelRegistry";

export type TouchAwaitingPostIngestDrainProgressOptions = {
    progressAt?: Date;
    countPendingForAccount?: (accountId: number) => Promise<number>;
};

/**
 * Throttled Mongo heartbeat for long-running sync executions (entity ingest,
 * tail steps, and deferred post-import drain).
 */
export function createSyncProgressHeartbeat(executionId: string): (
    entityStats?: SyncHistoryEntityStats
) => Promise<void> {
    let lastTouchMs = 0;

    return async (entityStats?: SyncHistoryEntityStats) => {
        const nowMs = Date.now();
        if (
            lastTouchMs > 0 &&
            nowMs - lastTouchMs < HEARTBEAT_INTERVAL_SECONDS * 1000
        ) {
            return;
        }
        lastTouchMs = nowMs;
        try {
            const updated = await touchExecutionProgress(executionId, {
                progressAt: new Date(nowMs),
                entityStats,
            });
            // Nest (or sweeper) already TIMED OUT / cancelled this execution —
            // propagate into the in-process cancel registry so the worker loop
            // stops even when cancel was issued from another process.
            if (updated == null) {
                requestConnectorSyncCancel(executionId);
            }
        } catch {
            // Best-effort — history must not block sync progress.
        }
    };
}

/** Heartbeat all RUNNING executions awaiting post-import drain for an account. */
export async function touchAwaitingPostIngestDrainProgress(
    accountId: number,
    options?: TouchAwaitingPostIngestDrainProgressOptions
): Promise<void> {
    const progressAt = options?.progressAt ?? new Date();
    const awaiting = await listAwaitingPostIngestDrainExecutions(accountId);
    for (const execution of awaiting) {
        try {
            let entityStats: SyncHistoryEntityStats | undefined;
            if (options?.countPendingForAccount) {
                const pending = await options.countPendingForAccount(accountId);
                entityStats = applyPostIngestDrainProgressToEntityStats(
                    execution.entity_stats,
                    pending
                );
            }
            await touchExecutionProgress(execution.execution_id, {
                progressAt,
                entityStats,
            });
        } catch {
            // Best-effort drain heartbeat.
        }
    }
}
