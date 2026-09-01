import type { PrismaClient } from "@prisma/client";
import { type RunInProcessSyncOptions, type RunInProcessSyncResult } from "../sync/runInProcessSync";
export interface SyncDueBillingConnectorsResult {
    success: boolean;
    message: string;
    processed: number;
    skipped: number;
    failed: number;
    skippedFrozenAccountIds: number[];
    results: RunInProcessSyncResult[];
    durationMs: number;
}
export interface SyncDueBillingConnectorsOptions {
    /** Override in-process sync (unit tests). */
    runSync?: (options: RunInProcessSyncOptions) => Promise<RunInProcessSyncResult>;
    /** Override UUID generation (unit tests). */
    createExecutionId?: () => string;
    /** Clock for due checks + stale sweep (unit tests). */
    now?: Date;
    /** Skip starting scheduled sync for these accounts (import/backfill freeze). */
    excludeAccountIds?: ReadonlySet<number>;
    /** Prometheus sink + structured log hook for scheduled syncs. */
    observability?: RunInProcessSyncOptions["observability"];
    onLog?: (message: string) => void;
}
/**
 * Cron entry: sync due Active+enabled billing connectors (Stage 2).
 * Uses in-process Priority sync (D71) until connectors path flip owns schedules (D65/D72).
 *
 * Persists each run to Mongo sync history (`trigger: scheduled`) via shared
 * syncHistory helpers. Requires `MONGODB_URI` in the cron/API process env
 * (same default as Nest: mongodb://localhost:27017/archaser).
 */
export declare function syncDueBillingConnectors(prisma: PrismaClient, options?: SyncDueBillingConnectorsOptions): Promise<SyncDueBillingConnectorsResult>;
