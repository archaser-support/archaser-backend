import type { PrismaClient } from "@prisma/client";
/**
 * Close Due/Overdue invoices with near-zero customer outstanding debt
 * (within ±INVOICE_PAID_TOLERANCE), then recalculate customer rollups and
 * refresh credit-insurance fields. Large negative outstanding (credit notes)
 * is not treated as Paid.
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
