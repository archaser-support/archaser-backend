import type { PrismaClient } from "@prisma/client";
/**
 * Args for connector post-ingest (mirrors Nest runArPostIngestForCustomers options).
 * Host callback or require — billing-connector must not hard-depend on Nest.
 */
export type ArPostIngestHostInput = {
    accountId: number;
    customerIds: number[];
    runReplay?: boolean;
    runMaturity?: boolean;
    /** Process Overdue for touched customers (default true in Nest orchestrator). */
    runProcessOverdue?: boolean;
    runLiveRefresh?: boolean;
    enqueueAsOfRewrite?: boolean;
    /** Preview / dry-run: Nest orchestrator skips all side effects when true. */
    dryRun?: boolean;
    asOfRewrite?: {
        importType: "Invoice" | "Payment";
        entityIds: number[];
    };
};
export type ArPostIngestHostFn = (input: ArPostIngestHostInput) => Promise<void>;
/**
 * Recompute invoice insurance target dates after amount/date upserts.
 * Uses the same Nest credit-insurance refresh as API due-date edits.
 */
export declare function refreshInsuranceTargetDatesViaHost(invoiceIds: number[], prisma: PrismaClient): Promise<number>;
/**
 * Default post-Invoice / payment-only AR post-ingest when the host does not
 * pass onArPostIngest (queue worker, scheduled sync, internal inline).
 */
export declare function runArPostIngestViaHost(input: ArPostIngestHostInput, prisma: PrismaClient): Promise<void>;
/**
 * Once after Invoice entity completion. Best-effort: errors are logged and do
 * not fail the sync. Caller must skip on dry-run.
 */
export declare function invokeConnectorArPostIngest(params: {
    accountId: number;
    customerIds: number[];
    invoiceEntityIds: number[];
    paymentEntityIds: number[];
    prisma: PrismaClient;
    onArPostIngest: ArPostIngestHostFn | undefined;
    log: (message: string) => void;
    /** When true (payment-only fallback), run deferred-payment maturity. */
    runMaturity?: boolean;
}): Promise<void>;
