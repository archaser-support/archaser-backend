import type { Invoice, InvoicePayment, PrismaClient } from "@prisma/client";
import type { ExtensionLinkedPayment } from "../extensions/types";
export type LinkDeferredPaymentAndRecalcResult = {
    invoicePayment: InvoicePayment;
    updatedInvoice: Invoice;
    alreadyLinked: boolean;
};
export { INVOICE_PAID_TOLERANCE, isWithinPaidTolerance, normalizeInvoicePaidTolerance, resolveInvoicePaidTolerance, } from "./invoicePaidTolerance";
export type InvoicePaidRecalcOptions = {
    normalizeNegativePaymentsForCreditClose?: boolean;
    isForcePaidClose?: (payment: ExtensionLinkedPayment) => boolean;
};
export declare function recalculateInvoiceFromLinkedPayments(tx: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector">, invoiceId: number, options?: InvoicePaidRecalcOptions): Promise<Invoice>;
/**
 * Recalculate many invoices with two reads and chunked writes instead of
 * three round-trips per invoice.
 */
export declare function recalculateInvoicesFromLinkedPayments(prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "billingConnector" | "$transaction">, targets: Map<number, InvoicePaidRecalcOptions>): Promise<void>;
export declare function linkDeferredPaymentAndRecalc(prisma: PrismaClient, params: {
    invoicePaymentId: number;
    invoiceId: number;
    forceRecalc?: boolean;
}): Promise<LinkDeferredPaymentAndRecalcResult>;
