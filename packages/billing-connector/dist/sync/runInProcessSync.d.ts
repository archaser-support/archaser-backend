import type { PrismaClient } from "@prisma/client";
export interface RunInProcessSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
}
export interface RunInProcessSyncResult {
    ok: boolean;
    accountId: number;
    provider: string;
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
    message: string;
    error?: string;
}
/**
 * In-process Priority sync for main API / worker (D71).
 * Pulls mapped entities, maps ERP fields, upserts into Postgres.
 */
export declare function runInProcessSync(options: RunInProcessSyncOptions): Promise<RunInProcessSyncResult>;
