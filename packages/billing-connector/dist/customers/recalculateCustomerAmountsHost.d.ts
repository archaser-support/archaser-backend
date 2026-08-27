import type { PrismaClient } from "@prisma/client";
/**
 * Default post-ingest rollup refresh used when the host does not pass
 * onCustomerBalancesFinal (queue worker, scheduled sync, internal inline).
 */
export declare function recalculateCustomerAmountsViaHost(customerIds: number[], prisma: PrismaClient): Promise<void>;
