import type { PrismaClient } from "@prisma/client";
export declare const VIRTUAL_PAYMENT_METHOD = "virtual";
export declare function buildVirtualPaymentReference(invoiceNumber: string): string;
export type ReconciledVirtualCloseCandidate = {
    invoiceId: number;
    customerId: number;
    invoiceNumber: string;
    paymentDate: Date;
};
export type ReconciledVirtualCloseByNumbersResult = {
    touchedIds: number[];
    customerIds: number[];
    missingNumbers: string[];
};
/**
 * Account 10149: for reconciled IDG_ARFNCITEMS4 invoices, upsert/delete one
 * virtual payment per invoice so remaining (full or partial) closes.
 * Handles positive AR invoices and credit notes (negative net / remaining).
 * Callers then recalc paid totals.
 */
export declare function applyReconciledVirtualCloses(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector" | "$transaction">, accountId: number, candidates: ReconciledVirtualCloseCandidate[], userId?: string): Promise<Set<number>>;
/**
 * Resolve invoice numbers from the payment feed and fill virtual shortfall
 * (full net when no real payments). Caller must recalc paid totals.
 */
export declare function applyReconciledVirtualClosesForInvoiceNumbers(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector" | "$transaction">, accountId: number, invoiceNumbers: string[], userId?: string, paymentDate?: Date): Promise<ReconciledVirtualCloseByNumbersResult>;
