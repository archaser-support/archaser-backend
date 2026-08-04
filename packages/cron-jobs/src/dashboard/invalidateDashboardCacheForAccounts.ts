import type { PrismaClient } from "@prisma/client";

/**
 * Invalidate pre-calculated dashboard metrics for affected accounts.
 */
export async function invalidateDashboardCacheForAccounts(
    prisma: PrismaClient,
    accountIds: number[]
): Promise<void> {
    const unique = Array.from(new Set(accountIds.filter((id) => id > 0)));
    if (unique.length === 0) {
        return;
    }

    await prisma.dashboardCache.deleteMany({
        where: { account_id: { in: unique } },
    });
}
