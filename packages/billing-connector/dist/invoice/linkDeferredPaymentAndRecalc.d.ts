import type { Invoice, InvoicePayment, PrismaClient } from "@prisma/client";
import type { ExtensionLinkedPayment } from "../extensions/types";
export type LinkDeferredPaymentAndRecalcResult = {
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
    alreadyLinked: boolean;
};
export { INVOICE_PAID_TOLERANCE, isWithinPaidTolerance, normalizeInvoicePaidTolerance, resolveInvoicePaidTolerance, } from "./invoicePaidTolerance";
export type InvoicePaidRecalcOptions = {
    isForcePaidClose?: (payment: ExtensionLinkedPayment) => boolean;
    /** When set, skips a BillingConnector lookup inside the transaction. */
    paidTolerance?: number;
};
export type BulkDeferredPaymentLink = {
    paymentId: number;
    invoiceId: number;
    /** When set, link also realigns payment amounts to the invoice currency. */
    amount?: number;
    customer_amount?: number;
    customer_currency?: string;
};
/**
 * Read-only paid-close settings for an account. Safe to resolve before an
 * interactive transaction so tolerance/extension lookups do not burn tx time.
 */
export declare function resolveInvoicePaidRecalcOptions(prisma: Pick<PrismaClient, "billingConnector">, accountId: number, overrides?: InvoicePaidRecalcOptions): Promise<InvoicePaidRecalcOptions>;
/**
 * Bulk-link deferred payments in chunks via UPDATE … FROM UNNEST. Simple rows
 * only set invoice_id; aligned rows also rewrite amount/currency columns.
 */
export declare function bulkLinkDeferredPayments(prisma: PrismaClient, accountId: number, rows: BulkDeferredPaymentLink[], modifiedAt: Date, options?: {
    onChunkLinked?: (linkedInChunk: number) => void;
}): Promise<number>;
export declare function recalculateInvoiceFromLinkedPayments(tx: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector">, invoiceId: number, options?: InvoicePaidRecalcOptions): Promise<Invoice>;
/**
 * Recalculate many invoices: two batched reads, in-memory totals, bulk writes.
 */
export declare function recalculateInvoicesFromLinkedPayments(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector" | "$transaction">, targets: Map<number, InvoicePaidRecalcOptions>, options?: {
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
}): Promise<void>;
/**
 * Link many deferred payments (`invoice_id` null → target), then recalculate
 * each affected invoice once via {@link recalculateInvoicesFromLinkedPayments}.
 */
export declare function linkDeferredPaymentsAndRecalcBatch(prisma: PrismaClient, links: Array<{
    invoicePaymentId: number;
    invoiceId: number;
}>, recalcOptions?: InvoicePaidRecalcOptions): Promise<{
    paymentsLinked: number;
    invoicesRecalculated: number;
}>;
export declare function linkDeferredPaymentAndRecalc(prisma: PrismaClient, params: {
    invoicePaymentId: number;
    invoiceId: number;
    forceRecalc?: boolean;
    recalcOptions?: InvoicePaidRecalcOptions;
}): Promise<LinkDeferredPaymentAndRecalcResult>;
