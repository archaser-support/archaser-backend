/**
 * Billing account extension (plugin) contract.
 * Transform runs after field mapping and before entity import.
 * Optional payment-close hooks run during payment import and invoice recalc.
 */
import type { PrismaClient } from "@prisma/client";

export type ExtensionEntityType =
    | "Customer"
    | "Payment"
    | "Invoice"
    | "Contact";

/** Cross-entity mapped rows for one sync window. */
export type ExtensionMappedBatch = Partial<
    Record<ExtensionEntityType, Record<string, unknown>[]>
>;

export interface ExtensionSyncWindow {
    start: Date | null;
    end: Date | null;
}

export interface ExtensionTransformContext {
    accountId: number;
    window: ExtensionSyncWindow;
    batch: ExtensionMappedBatch;
    extension_config: Record<string, unknown> | null;
}

export type ExtensionLinkedPayment = {
    payment_method: string | null;
};

export type ExtensionCreditPaymentCloseInput = {
    rawErpRow: Record<string, unknown>;
    invoiceCustomCode1: string | null | undefined;
    customerAmount: number;
};

/** Map payment amounts onto the linked invoice's currency using ERP dual-currency fields. */
export type ExtensionAlignPaymentAmountsInput = {
    amount?: number;
    customer_amount: number;
    customer_currency: string;
    invoiceCustomerCurrency: string | null | undefined;
    rawErpRow: Record<string, unknown>;
};

export type ExtensionAlignedPaymentAmounts = {
    amount?: number;
    customer_amount: number;
    customer_currency: string;
};

/** One payment that was linked (or re-confirmed linked) during import. */
export type ExtensionPaymentLinkedCandidate = {
    invoiceId: number;
    customerId: number;
    invoiceNumber: string;
    paymentDate: Date;
    rawErpRow: Record<string, unknown>;
};

export type ExtensionAfterPaymentLinkedContext = {
    prisma: Pick<PrismaClient, "invoice" | "invoicePayment" | "$transaction">;
    accountId: number;
    userId?: string;
    candidates: ExtensionPaymentLinkedCandidate[];
};

export type ExtensionAfterPaymentLinkedResult = {
    /** Invoice ids that need paid-total recalc after the extension ran. */
    invoiceIdsToRecalc: number[];
};

export interface BillingAccountExtension {
    key: string;
    /** Human-readable label for admin UI / docs. */
    label: string;
    /**
     * Post-map, pre-save transform. May rewrite, drop, or expand rows.
     * Receives the full cross-entity batch for the current window.
     */
    transform(
        ctx: ExtensionTransformContext
    ): ExtensionMappedBatch | Promise<ExtensionMappedBatch>;
    /**
     * Linked payment is a close marker (not a money settlement).
     * Recalc then stamps the invoice Paid from invoice net.
     */
    isForcePaidClose?(payment: ExtensionLinkedPayment): boolean;
    /**
     * After payments are linked to invoices (including unchanged re-sync skips),
     * run account-specific close behavior (e.g. virtual gap payments).
     */
    afterPaymentLinked?(
        ctx: ExtensionAfterPaymentLinkedContext
    ):
        | ExtensionAfterPaymentLinkedResult
        | Promise<ExtensionAfterPaymentLinkedResult>;
    /**
     * Use absolute payment amounts when closing a credit invoice.
     */
    shouldNormalizeNegativeCreditPayments?(
        row: ExtensionCreditPaymentCloseInput
    ): boolean;
    /** Canonicalize payment vs invoice currency before attach. */
    normalizePaymentCurrency?(currency: string | null | undefined): string;
    /**
     * Optional dual-currency / FX alignment before amount resolution
     * (e.g. Priority CODE/CREDIT1 vs CODE5/CREDIT5).
     */
    alignPaymentAmountsForInvoice?(
        input: ExtensionAlignPaymentAmountsInput
    ): ExtensionAlignedPaymentAmounts;
}

export type ExtensionAttachmentUpsertInput = {
    /** Undefined = omit key change; null/"" = clear attachment. */
    extension_key?: string | null;
    /** Undefined = omit config change; object/null when clearing with key. */
    extension_config?: unknown;
    /** Current key on the connector (for config-only updates). */
    existingKey: string | null;
};

export type ExtensionAttachmentUpsertPatch = {
    extension_key?: string | null;
    extension_config?: Record<string, unknown> | null;
};
