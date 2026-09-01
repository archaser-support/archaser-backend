import type { PrismaClient } from "@prisma/client";
export interface MaturityResult {
    matured: number;
    deferredRemaining: number;
    /** Eligible deferred payments considered for linking in this pass. */
    totalCandidates: number;
    /** Customers whose invoices were linked/recalculated in this pass. */
    affectedCustomerIds: number[];
}
export interface MaturityProgress {
    linked: number;
    totalCandidates: number;
    /**
     * What the pass is doing right now. Linking is only part of the wall time;
     * currency alignment, extension closes and paid-total recalcs follow it.
     */
    detail?: MaturityProgressDetail;
}
export interface MaturityProgressDetail {
    step: "link" | "align" | "close" | "recalc";
    processed?: number;
    total?: number;
}
/**
 * Rebuild a minimal ERP-shaped row for extension hooks after maturity.
 * When reference is FRECONNUM|FNCNUM|KLINE, treat as reconciled (BAL=0).
 * Without a leading recon segment, afterPaymentLinked recon checks no-op.
 */
export declare function rawErpRowFromMaturedPayment(payment: {
    reference: string;
    customer_amount: number;
    invoice_number: string;
}): Record<string, unknown>;
/**
 * Link deferred payments whose invoice now exists and whose payment_date has
 * matured. Groups links with updateMany per invoice_id, runs extension
 * afterPaymentLinked (virtual recon close), then batch-recalcs paid totals.
 */
export declare function applyMaturedDeferredPayments(prisma: PrismaClient, accountId: number, asOf: Date, invoiceNumbers?: string[], options?: {
    onProgress?: (progress: MaturityProgress) => void;
    userId?: string;
}): Promise<MaturityResult>;
