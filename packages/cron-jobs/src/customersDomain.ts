import type { PrismaClient } from "@prisma/client";
import {
    loadRecalculateCustomerAmountsModule,
    type RecalculateCustomerAmountsHostOptions,
} from "@archaser/billing-connector";

/**
 * Customer AR rollups still live in the api service (`api/dist/customers`).
 * Loading is owned by `@archaser/billing-connector` (multi-layout resolve,
 * CUSTOMERS_DOMAIN_ROOT, boot assert). See recalculateCustomerAmountsHost.ts
 * deploy contract comments.
 */

export type CustomerOutstandingAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};

export async function recalculateCustomerAmountsViaApi(
    customerIds: number[],
    prisma: PrismaClient,
    options?: RecalculateCustomerAmountsHostOptions
): Promise<void> {
    if (customerIds.length === 0) {
        return;
    }
    await loadRecalculateCustomerAmountsModule().recalculateCustomerAmounts(
        customerIds,
        prisma,
        options
    );
}

export async function calculateOutstandingAmountsForCustomersViaApi(
    customerIds: number[],
    prisma: PrismaClient
): Promise<Map<number, CustomerOutstandingAmounts>> {
    return loadRecalculateCustomerAmountsModule().calculateOutstandingAmountsForCustomers(
        customerIds,
        prisma
    );
}
