import type { PrismaClient } from "@prisma/client";
export type RecalculateCustomerAmountsHostOptions = {
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
    concurrency?: number;
    progressEvery?: number;
};
/**
 * Default post-ingest rollup refresh used when the host does not pass
 * onCustomerBalancesFinal (queue worker, scheduled sync, internal inline).
 */
export declare function recalculateCustomerAmountsViaHost(customerIds: number[], prisma: PrismaClient, options?: RecalculateCustomerAmountsHostOptions): Promise<void>;
