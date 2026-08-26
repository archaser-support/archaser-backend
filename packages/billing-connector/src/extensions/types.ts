/**
 * Billing account extension (plugin) contract.
 * Transform runs after field mapping and before entity import.
 * Optional payment-close hooks run during payment import and invoice recalc.
 */
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
     * Use absolute payment amounts when closing a credit invoice.
     */
    shouldNormalizeNegativeCreditPayments?(
        row: ExtensionCreditPaymentCloseInput
    ): boolean;
    /** Canonicalize payment vs invoice currency before attach. */
    normalizePaymentCurrency?(currency: string | null | undefined): string;
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
