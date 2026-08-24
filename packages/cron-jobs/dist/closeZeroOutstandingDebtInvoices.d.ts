import type { PrismaClient } from "@prisma/client";
/**
 * Close Due/Overdue invoices with zero (or tolerance) customer outstanding debt,
 * then recalculate customer rollups and refresh credit-insurance fields.
 */
export declare function closeZeroOutstandingDebtInvoices(prisma: PrismaClient): Promise<{
    success: boolean;
    message: string;
    summary: {
        invoicesClosed: number;
        customersRecalculated: number;
    };
    durationMs: number;
}>;
