import type { PrismaClient } from "@prisma/client";
export declare const VIRTUAL_PAYMENT_METHOD = "virtual";
export declare function buildVirtualPaymentReference(invoiceNumber: string): string;
export type ReconciledVirtualCloseCandidate = {
    invoiceId: number;
    customerId: number;
    invoiceNumber: string;
    paymentDate: Date;
};
/**
 * Account 10149: for reconciled receipts, upsert/delete one virtual payment per
 * invoice so shortfall closes. Callers then recalc paid totals.
 */
export declare function applyReconciledVirtualCloses(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "$transaction">, accountId: number, candidates: ReconciledVirtualCloseCandidate[], userId?: string): Promise<Set<number>>;
