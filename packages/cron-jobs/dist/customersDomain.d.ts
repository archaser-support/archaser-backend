import type { PrismaClient } from "@prisma/client";
export type CustomerOutstandingAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};
export declare function recalculateCustomerAmountsViaApi(customerIds: number[], prisma: PrismaClient): Promise<void>;
export declare function calculateOutstandingAmountsForCustomersViaApi(customerIds: number[], prisma: PrismaClient): Promise<Map<number, CustomerOutstandingAmounts>>;
