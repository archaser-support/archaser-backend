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
    /** Invoice / payment rows imported this sync (scopes live gap refresh). */
    invoiceEntityIds?: number[];
    paymentEntityIds?: number[];
    affectedInvoiceIds?: number[];
    /** Account MEP breach start date — narrows replay event load when set. */
    mepBreachStartDate?: Date | null;
    /** Live per-customer progress for the sync progress panel. */
    onProgress?: (progress: ArPostIngestProgress) => void;
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
    /** Which orchestrator step is running (replay, process_overdue, ...). */
    step?: string;
    customerId?: number;
    /** Progress inside that step, e.g. replay events for one customer. */
    detail?: {
        processed: number;
        total: number;
    };
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
export type DeferredArPostIngestStep = "replay" | "process_overdue" | "live_refresh";
/** Heavy CI steps deferred to the worker. Process Overdue is a separate sync tail step. */
export declare const DEFERRED_CI_POST_INGEST_STEPS: DeferredArPostIngestStep[];
export type PostIngestDrainScheduleResult = {
    queued: boolean;
    reason?: string;
};
export type ConnectorPostIngestDeferOptions = {
    /**
     * When true, enqueue replay/live-refresh on the worker instead of blocking
     * the billing connector sync tail. Process Overdue runs in its own tail
     * step before post-ingest when the host wires onProcessOverdueCustomers.
     */
    deferPostIngest?: boolean;
    enqueueDeferredSteps?: (args: {
        accountId: number;
        customerIds: number[];
        steps: DeferredArPostIngestStep[];
    }) => Promise<void>;
    /**
     * Ask the worker to drain the AR post-ingest retry queue soon.
     * Return `{ queued: false }` so the host can fall back to inline CI steps.
     */
    schedulePostIngestDrain?: () => Promise<PostIngestDrainScheduleResult | void>;
};
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
    /** When false, Process Overdue already ran in the sync tail step. Default true. */
    runProcessOverdue?: boolean;
    /** Live per-customer progress for the sync progress panel. */
    onProgress?: (progress: ArPostIngestProgress) => void;
} & ConnectorPostIngestDeferOptions): Promise<{
    deferred: boolean;
}>;
