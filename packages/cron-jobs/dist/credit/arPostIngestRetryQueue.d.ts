import type { ArPostIngestError } from "./arPostIngestOrchestrator";
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
 * Records per-customer failures for retry. Account-level failures (maturity,
 * as-of enqueue) are skipped: they carry no customer and the as-of path needs
 * the original entity ids, which are gone by the time the drain runs.
 */
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
