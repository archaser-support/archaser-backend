import { Prisma, PrismaClient } from "@prisma/client";
export type RecalcDbClient = PrismaClient | Prisma.TransactionClient;
export type CustomerDueAmounts = {
    total_due_amount: number;
    no_of_due_invoices: number;
    customer_due_amount1: number;
    customer_due_currency1: string | null;
    customer_due_amount2: number;
    customer_due_currency2: string | null;
};
export type CustomerOverdueAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};
export type CustomerAmountsResult = {
    due: CustomerDueAmounts;
    overdue: CustomerOverdueAmounts;
};
export declare function calculateDueAmountsForCustomers(customerIds: number[], db: RecalcDbClient): Promise<Map<number, CustomerDueAmounts>>;
export declare function calculateOutstandingAmountsForCustomers(customerIds: number[], db: RecalcDbClient): Promise<Map<number, CustomerOverdueAmounts>>;
export declare function recalculateCustomerAmounts(customerIds: number[], db: RecalcDbClient): Promise<Map<number, CustomerAmountsResult>>;
