"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateDashboardCacheForAccounts = invalidateDashboardCacheForAccounts;
/**
 * Invalidate pre-calculated dashboard metrics for affected accounts.
 */
async function invalidateDashboardCacheForAccounts(prisma, accountIds) {
    const unique = Array.from(new Set(accountIds.filter((id) => id > 0)));
    if (unique.length === 0) {
        return;
    }
    await prisma.dashboardCache.deleteMany({
        where: { account_id: { in: unique } },
    });
}
