import * as path from "path";
import type { PrismaClient } from "@prisma/client";

function resolveCustomersDomainRoot(): string {
    if (process.env.CUSTOMERS_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CUSTOMERS_DOMAIN_ROOT.trim());
    }
    // packages/cron-jobs/dist → ../../../api/dist/customers
    return path.resolve(__dirname, "../../../api/dist/customers");
}

export function requireCustomersDomainModule<T>(relativeJsPath: string): T {
    const full = path.join(resolveCustomersDomainRoot(), relativeJsPath);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(full) as T;
}

export async function recalculateCustomerAmountsViaApi(
    customerIds: number[],
    prisma: PrismaClient
): Promise<void> {
    if (customerIds.length === 0) {
        return;
    }
    const mod = requireCustomersDomainModule<{
        recalculateCustomerAmounts: (
            ids: number[],
            db: PrismaClient
        ) => Promise<unknown>;
    }>("domain/recalculateCustomerAmounts.js");
    await mod.recalculateCustomerAmounts(customerIds, prisma);
}
