import type { PrismaClient } from "@prisma/client";
/**
 * Invalidate pre-calculated dashboard metrics for affected accounts.
 */
export declare function invalidateDashboardCacheForAccounts(prisma: PrismaClient, accountIds: number[]): Promise<void>;
