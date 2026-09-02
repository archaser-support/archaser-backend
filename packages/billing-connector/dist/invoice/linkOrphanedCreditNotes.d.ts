import type { PrismaClient } from "@prisma/client";
export interface LinkOrphanedCreditNotesResult {
    linkedCount: number;
    affectedInvoiceIds: number[];
}
export declare function linkOrphanedCreditNotes(prisma: PrismaClient, params: {
    accountId: number;
    targetInvoiceNumbers: string[];
}): Promise<LinkOrphanedCreditNotesResult>;
