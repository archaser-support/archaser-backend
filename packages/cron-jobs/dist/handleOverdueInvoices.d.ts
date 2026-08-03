import type { PrismaClient } from "@prisma/client";
/**
 * Process overdue invoices: mark past-due Due invoices Overdue, recalc amounts,
 * activate inactive customers with debt, open collection periods when needed.
 */
export declare function handleOverdueInvoices(prisma: PrismaClient, customerId?: number): Promise<{
    success: boolean;
    message: string;
    summary: Record<string, unknown>;
    durationMs: number;
}>;
