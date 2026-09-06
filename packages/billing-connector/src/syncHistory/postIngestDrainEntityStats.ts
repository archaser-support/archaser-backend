import {
    POST_INGEST_ENTITY_STATS_KEY,
    type ConnectorEntityStatSlice,
} from "../sync/connectorSyncRuntime";
import type { SyncHistoryEntityStats } from "./types";

/**
 * Reflect worker drain progress on the Refresh AR tail slice. While customers
 * remain on ArPostIngestRetryQueue, keep the step running with a real counter;
 * when pending hits zero, mark done so the progress panel can finish.
 */
export function applyPostIngestDrainProgressToEntityStats(
    entityStats: SyncHistoryEntityStats,
    pendingCustomers: number
): SyncHistoryEntityStats {
    const slice = entityStats[POST_INGEST_ENTITY_STATS_KEY];
    if (!slice) {
        return entityStats;
    }

    const total = slice.pulled ?? 0;
    if (total <= 0) {
        return entityStats;
    }

    const processed = Math.max(0, total - pendingCustomers);
    const detail: ConnectorEntityStatSlice["detail"] = {
        step: "worker_drain",
        processed,
        total,
    };

    if (pendingCustomers <= 0) {
        return {
            ...entityStats,
            [POST_INGEST_ENTITY_STATS_KEY]: {
                ...slice,
                status: "done",
                success: total,
                pulled: total,
                failed: slice.failed ?? 0,
                skipped: slice.skipped ?? 0,
                detail,
            },
        };
    }

    return {
        ...entityStats,
        [POST_INGEST_ENTITY_STATS_KEY]: {
            ...slice,
            status: "running",
            success: processed,
            pulled: total,
            failed: slice.failed ?? 0,
            skipped: slice.skipped ?? 0,
            detail,
        },
    };
}
