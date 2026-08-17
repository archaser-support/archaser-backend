import type { PrismaClient } from "@prisma/client";
import { type ImportEntityType } from "../import/entityImporter";
export declare class ConnectorSyncCancelledError extends Error {
    constructor(executionId: string);
}
export interface RunInProcessSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
    executionId?: string;
    mode?: "backfill" | "incremental";
    importTypes?: ImportEntityType[];
}
export interface RunInProcessSyncResult {
    ok: boolean;
    accountId: number;
    provider: string;
    cancelled?: boolean;
    executionId?: string;
    stats: {
        customersProcessed: number;
        contactsProcessed: number;
        invoicesProcessed: number;
        paymentsProcessed: number;
        customersImported: number;
        contactsImported: number;
        invoicesImported: number;
        paymentsImported: number;
        importErrors: number;
    };
    entity_stats: Record<string, {
        pulled: number;
        success: number;
        failed: number;
        skipped: number;
    }>;
    message: string;
    error?: string;
}
/**
 * In-process Priority sync for main API / worker (D71).
 * Pulls mapped entities, maps ERP fields, upserts into Postgres.
 * Manual backfill/incremental checks the in-process cancel registry between entities.
 */
export declare function runInProcessSync(options: RunInProcessSyncOptions): Promise<RunInProcessSyncResult>;
