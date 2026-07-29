import { PrismaClient } from "@prisma/client";
type PrismaClientLike = PrismaClient;
type RawCapableClient = {
    $queryRaw: PrismaClientLike["$queryRaw"];
    $executeRaw: PrismaClientLike["$executeRaw"];
};
export declare const REWRITE_QUEUE_STALE_PROCESSING_MS: number;
export type RewriteRange = {
    customerIds: number[];
    fromDate: Date;
    toDate: Date;
};
export declare function resolveRewriteDrainStart(fromDate: Date, checkpointDate: Date | null | undefined): Date;
export declare function coalesceCheckpointDate(existingFromDate: Date, mergedFromDate: Date, existingCheckpoint: Date | null | undefined): Date | null;
export declare function isStaleProcessingUpdatedAt(updatedAt: Date, now?: Date, staleMs?: number): boolean;
export declare function isAdminBackfillBlockingDrain(status: string | null | undefined): boolean;
export declare function mergeRewriteRange(existing: RewriteRange, incoming: RewriteRange): RewriteRange;
export type EnqueueAsOfRewriteInput = {
    accountId: number;
    customerIds?: number[];
    fromDate: Date;
    toDate: Date;
};
export declare function enqueueAsOfRewrite(input: EnqueueAsOfRewriteInput, dbClient?: PrismaClientLike): Promise<void>;
export declare function enqueueAsOfRewriteInTransaction(tx: RawCapableClient, input: EnqueueAsOfRewriteInput): Promise<void>;
export declare function enqueueRewriteForImport(args: {
    accountId: number;
    importType: "Invoice" | "Payment";
    entityIds: number[];
    customerIds: number[];
}, dbClient?: PrismaClientLike): Promise<void>;
export type DrainAsOfRewriteResult = {
    itemsProcessed: number;
    daysRewritten: number;
    failures: number;
    skippedForBackfill: number;
};
type DrainWriters = {
    syncCustomerPolicyTrendSnapshotForAccount: (accountId: number, options: {
        snapshotDate: Date;
        customerIds?: number[];
    }) => Promise<unknown>;
    takeCreditDashboardDailySnapshotsForAccount: (accountId: number, options: {
        snapshotDate: Date;
    }) => Promise<unknown>;
};
export declare function drainAsOfRewriteQueue(options?: {
    maxItems?: number;
    dbClient?: PrismaClientLike;
    now?: Date;
    writers?: Partial<DrainWriters>;
}): Promise<DrainAsOfRewriteResult>;
export {};
