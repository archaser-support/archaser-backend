import type { PrismaClient } from "@prisma/client";
export type HelamOffsetStampResult = {
    closedIds: number[];
    customerIds: number[];
    missingNumbers: string[];
};
/**
 * Stamp Helam offset-pair invoices Paid from net (no virtual, no cancel payment).
 * Removes leftover virtual / Helam method payments so paid totals stay correct.
 */
export declare function applyHelamOffsetStampClosesForInvoiceNumbers(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "$transaction">, accountId: number, invoiceNumbers: string[], userId?: string, options?: {
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
}): Promise<HelamOffsetStampResult>;
