import { type PrismaClient } from "@prisma/client";
export type ReplayEventType = "invoice_open" | "payment_apply";
export type ReplayInvoiceInput = {
    invoiceNumber: string;
    invoiceDate: Date;
    netAmount: number;
    customerNetAmount: number;
    /** Existing DB id when replaying persisted invoices */
    invoiceId?: number;
};
export type ReplayPaymentInput = {
    id: number;
    invoiceNumber: string;
    paymentDate: Date;
    amount: number;
    customerAmount: number;
    invoiceId?: number | null;
};
export type ReplayEvent = {
    type: "invoice_open";
    date: Date;
    payload: ReplayInvoiceInput;
} | {
    type: "payment_apply";
    date: Date;
    payload: ReplayPaymentInput;
};
export type ReplaySimulationInvoice = {
    invoiceNumber: string;
    invoiceId?: number;
    netAmount: number;
    customerNetAmount: number;
    outstanding: number;
    customerOutstanding: number;
    limitAssessedAmount: number | null;
};
export type ReplaySimulationConfig = {
    approvedLimit: number;
    topUpTotal?: number;
};
export type ReplaySimulationSummary = {
    eventsApplied: number;
    paymentsLinked: number;
    deferredRemaining: number;
};
export type ReplayCustomerSummary = ReplaySimulationSummary & {
    customerId: number;
};
export type ReplayBatchSummary = {
    customersAffected: number;
    eventsApplied: number;
    paymentsLinked: number;
    deferredRemaining: number;
    perCustomer: ReplayCustomerSummary[];
};
/** Same-day tie-break: invoice_open before payment_apply. */
export declare function compareReplayEvents(a: ReplayEvent, b: ReplayEvent): number;
export declare function sortReplayEvents(events: ReplayEvent[]): ReplayEvent[];
export declare function buildReplayEvents(invoices: ReplayInvoiceInput[], payments: ReplayPaymentInput[]): ReplayEvent[];
/**
 * Pure in-memory chronological replay for capacity-gap timeline rules.
 * Stamps limit_assessed_amount at invoice_open using open AR with only
 * payments applied on earlier timeline events (same-day payments apply after
 * invoice_open due to tie-break).
 */
export declare function simulateCustomerArReplay(config: ReplaySimulationConfig, invoices: ReplayInvoiceInput[], payments: ReplayPaymentInput[]): {
    summary: ReplaySimulationSummary;
    invoices: ReplaySimulationInvoice[];
};
export declare function getInvoiceGap(inv: ReplaySimulationInvoice): number;
export type ReplayCustomerArImportParams = {
    customerId: number;
    accountId: number;
    invoices?: ReplayInvoiceInput[];
    payments?: ReplayPaymentInput[];
    approvedLimit?: number;
    approvedLimitCurrency?: string | null;
    /** Overrides the per-invoice-date top-up resolution when supplied. */
    topUpTotal?: number;
    dbClient?: PrismaClient;
    /** Event-level progress; a single customer can carry thousands of events. */
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
    /**
     * When true (default), still link payments with `invoice_id = null`.
     * Already-linked payments only update the in-memory open-AR timeline.
     */
    linkDeferredPayments?: boolean;
    /**
     * When true, stamp insurance CTV fields after assessed amounts (batched).
     * Default false: post-ingest capacity gap only needs assessed stamps + live
     * refresh; per-invoice CTV stamping dominated runtime at Helam scale.
     */
    stampInsuranceFields?: boolean;
    /**
     * When set, seed open AR from pre-cutover invoices and replay only events on
     * or after this date (inclusive). Stamps only apply to in-scope invoices.
     */
    mepBreachStartDate?: Date | null;
};
/**
 * Chronological AR replay for one customer.
 *
 * Computes `limit_assessed_amount` entirely in memory (open-AR timeline), then
 * bulk-writes stamps. Deferred payments (`invoice_id` null) are linked afterward;
 * already-linked payments only affect the in-memory timeline — no per-event
 * forceRecalc. Does not rewrite outstanding columns.
 */
export declare function replayCustomerArImport(params: ReplayCustomerArImportParams): Promise<ReplayCustomerSummary>;
export declare function replayArImportForCustomers(customerIds: number[], accountId: number, dbClient?: PrismaClient): Promise<ReplayBatchSummary>;
