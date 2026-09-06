import * as path from "path";
import type { PrismaClient } from "@prisma/client";

/**
 * Customer AR rollups still live in the api service (`api/src/customers/domain`)
 * and are reached by path. Unlike the credit-insurance domain, they have not
 * been extracted into a shared leaf package yet, so this loader is the last
 * remaining cross-service path require. See the slice 04 implementation notes.
 */
function resolveCustomersDomainRoot(): string {
    if (process.env.CUSTOMERS_DOMAIN_ROOT?.trim()) {
        return path.resolve(process.env.CUSTOMERS_DOMAIN_ROOT.trim());
    }
    // packages/cron-jobs/dist → ../../../api/dist/customers
    return path.resolve(__dirname, "../../../api/dist/customers");
}

export type CustomerOutstandingAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};

type RecalculateCustomerAmountsModule = {
    recalculateCustomerAmounts: (
        ids: number[],
        db: PrismaClient,
        options?: {
            onProgress?: (progress: {
                processed: number;
                total: number;
            }) => void;
            concurrency?: number;
            progressEvery?: number;
        }
    ) => Promise<unknown>;
    calculateOutstandingAmountsForCustomers: (
        ids: number[],
        db: PrismaClient
    ) => Promise<Map<number, CustomerOutstandingAmounts>>;
};

function loadRecalculateCustomerAmounts(): RecalculateCustomerAmountsModule {
    const full = path.join(
        resolveCustomersDomainRoot(),
        "domain/recalculateCustomerAmounts.js"
    );
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(full) as RecalculateCustomerAmountsModule;
}

export async function recalculateCustomerAmountsViaApi(
    customerIds: number[],
    prisma: PrismaClient
): Promise<void> {
    if (customerIds.length === 0) {
        return;
    }
    await loadRecalculateCustomerAmounts().recalculateCustomerAmounts(
        customerIds,
        prisma
    );
}

export async function calculateOutstandingAmountsForCustomersViaApi(
    customerIds: number[],
    prisma: PrismaClient
): Promise<Map<number, CustomerOutstandingAmounts>> {
    return loadRecalculateCustomerAmounts().calculateOutstandingAmountsForCustomers(
        customerIds,
        prisma
    );
}
