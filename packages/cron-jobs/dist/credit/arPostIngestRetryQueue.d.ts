import type { ArPostIngestError, ArPostIngestStep } from "./arPostIngestOrchestrator";
/** Processing rows older than this are assumed abandoned and reclaimed. */
export declare const AR_POST_INGEST_RETRY_STALE_PROCESSING_MS: number;
/** Beyond this the row is parked as `failed` so it stops consuming drain slots. */
export declare const AR_POST_INGEST_RETRY_MAX_ATTEMPTS = 5;
type DbClient = {
    $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number>;
    $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};
export type EnqueueArPostIngestRetryResult = {
    customersEnqueued: number;
};
/**
 * Intentionally queue post-ingest steps (e.g. after billing connector backfill)
 * so replay/overdue/live-refresh run on the worker instead of blocking sync.
 */
export declare function enqueueArPostIngestSteps(accountId: number, customerIds: number[], steps: ArPostIngestStep[], options?: {
    dbClient?: DbClient;
    now?: Date;
}): Promise<EnqueueArPostIngestRetryResult>;
export declare function enqueueArPostIngestRetries(accountId: number, errors: ArPostIngestError[], options?: {
    dbClient?: DbClient;
    now?: Date;
}): Promise<EnqueueArPostIngestRetryResult>;
export type DrainArPostIngestRetryResult = {
    itemsProcessed: number;
    failures: number;
    givenUp: number;
};
/**
 * Retries queued customers. Mirrors the as-of rewrite drain: reclaim stale
 * `processing` rows, claim optimistically, reset to `pending` on failure.
 */
export declare function drainArPostIngestRetryQueue(options?: {
    maxItems?: number;
    dbClient?: DbClient;
    now?: Date;
    runPostIngest?: (args: {
        accountId: number;
        customerIds: number[];
        steps: string[];
    }) => Promise<{
        errors: ArPostIngestError[];
    }>;
}): Promise<DrainArPostIngestRetryResult>;
export {};
