import * as path from "path";
import type { PrismaClient } from "@prisma/client";

/**
 * Resolves api customers domain (same layout as cron-jobs) so connector sync
 * can refresh denormalized due/overdue without a hard package dependency on api.
 */
function resolveCustomersDomainRoot(): string {
    if (process.env.CUSTOMERS_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CUSTOMERS_DOMAIN_ROOT.trim());
    }
    // packages/billing-connector/dist/customers → ../../../api/dist/customers
    return path.resolve(__dirname, "../../../api/dist/customers");
}

/**
 * Default post-ingest rollup refresh used when the host does not pass
 * onCustomerBalancesFinal (queue worker, scheduled sync, internal inline).
 */
export async function recalculateCustomerAmountsViaHost(
    customerIds: number[],
    prisma: PrismaClient
): Promise<void> {
    if (customerIds.length === 0) {
        return;
    }
    const full = path.join(
        resolveCustomersDomainRoot(),
        "domain/recalculateCustomerAmounts.js"
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(full) as {
        recalculateCustomerAmounts: (
            ids: number[],
            db: PrismaClient
        ) => Promise<unknown>;
    };
    await mod.recalculateCustomerAmounts(customerIds, prisma);
}
