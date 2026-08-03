import type { PrismaClient } from "@prisma/client";
import { type RunInProcessSyncResult } from "../sync/runInProcessSync";
export interface SyncDueBillingConnectorsResult {
    success: boolean;
    message: string;
    processed: number;
    skipped: number;
    failed: number;
    results: RunInProcessSyncResult[];
    durationMs: number;
}
/**
 * Cron entry: sync due Active+enabled billing connectors (Stage 2).
 * Uses in-process Priority sync (D71) until connectors path flip owns schedules (D65/D72).
 */
export declare function syncDueBillingConnectors(prisma: PrismaClient): Promise<SyncDueBillingConnectorsResult>;
