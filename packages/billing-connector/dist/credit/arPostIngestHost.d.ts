import type { PrismaClient } from "@prisma/client";
/**
 * Args for connector post-ingest (mirrors Nest runArPostIngestForCustomers options).
 * Host callback or registered orchestrator — billing-connector must not
 * hard-depend on Nest.
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
    /** Live per-customer progress for the sync progress panel. */
    onProgress?: (progress: {
        completed: number;
        total: number;
    }) => void;
};
export type ArPostIngestHostFn = (input: ArPostIngestHostInput) => Promise<void>;
/**
 * Result contract of the api service's `runArPostIngestForCustomers`. Only the
 * fields this package acts on are declared; the orchestrator may return more.
 */
export type ArPostIngestOrchestratorResult = {
    skipped: boolean;
    /** Per-step failures the orchestrator swallowed so ingest could finish. */
    errors?: Array<{
        step: string;
        customerId?: number;
        message: string;
        stack?: string;
    }>;
};
export type ArPostIngestOrchestratorFn = (options: ArPostIngestHostInput) => Promise<ArPostIngestOrchestratorResult>;
export type ArPostIngestProgress = {
    completed: number;
    total: number;
};
export declare function registerArPostIngestOrchestrator(orchestrator: ArPostIngestOrchestratorFn): void;
export declare function isArPostIngestOrchestratorRegistered(): boolean;
export declare function resetArPostIngestOrchestratorForTests(): void;
/**
 * Recompute invoice insurance target dates after amount/date upserts.
 * Uses the same credit-insurance refresh as API due-date edits.
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
    /** Live per-customer progress for the sync progress panel. */
    onProgress?: (progress: ArPostIngestProgress) => void;
}): Promise<void>;
