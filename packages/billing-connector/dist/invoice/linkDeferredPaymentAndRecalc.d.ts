import type { Invoice, InvoicePayment, PrismaClient } from "@prisma/client";
export type LinkDeferredPaymentAndRecalcResult = {
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
    alreadyLinked: boolean;
};
export declare const INVOICE_PAID_TOLERANCE = 0.2;
/** Exact FNCPATNAME close code stored on InvoicePayment.payment_method. */
export declare const IDIGITAL_HELAM_PAYMENT_METHOD = "\u05D7\u05DC\u05DE";
export type InvoicePaidRecalcOptions = {
    normalizeNegativePaymentsForCreditClose?: boolean;
};
export declare function recalculateInvoiceFromLinkedPayments(tx: Pick<PrismaClient, "invoice" | "invoicePayment">, invoiceId: number, options?: InvoicePaidRecalcOptions): Promise<Invoice>;
/**
 * Recalculate many invoices with two reads and chunked writes instead of
 * three round-trips per invoice.
 */
export declare function recalculateInvoicesFromLinkedPayments(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "$transaction">, targets: Map<number, InvoicePaidRecalcOptions>): Promise<void>;
export declare function linkDeferredPaymentAndRecalc(prisma: PrismaClient, params: {
    invoicePaymentId: number;
    invoiceId: number;
    forceRecalc?: boolean;
}): Promise<LinkDeferredPaymentAndRecalcResult>;
