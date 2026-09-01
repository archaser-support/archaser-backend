import type { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    enqueueRewriteForImport,
    refreshInsuranceTargetDatesForInvoiceIds,
} from "@archaser/credit-insurance-domain";

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

export type ArPostIngestHostFn = (
    input: ArPostIngestHostInput
) => Promise<void>;

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

export type ArPostIngestOrchestratorFn = (
    options: ArPostIngestHostInput
) => Promise<ArPostIngestOrchestratorResult>;

export type ArPostIngestProgress = {
    completed: number;
    total: number;
    /** Which orchestrator step is running (replay, process_overdue, ...). */
    step?: string;
    customerId?: number;
    /** Progress inside that step, e.g. replay events for one customer. */
    detail?: { processed: number; total: number };
};

/**
 * Host port for the AR post-ingest orchestrator.
 *
 * The orchestrator lives in `@archaser/cron-jobs`, which depends on this
 * package, so importing it back would create a cycle. Every process that can
 * reach the no-callback fallback registers it at startup instead: the api
 * (`CreditInsuranceModule`), connectors (`AppModule`) and worker (runtime start).
 */
let registeredOrchestrator: ArPostIngestOrchestratorFn | undefined;

export function registerArPostIngestOrchestrator(
    orchestrator: ArPostIngestOrchestratorFn
): void {
    registeredOrchestrator = orchestrator;
}

export function isArPostIngestOrchestratorRegistered(): boolean {
    return registeredOrchestrator !== undefined;
}

export function resetArPostIngestOrchestratorForTests(): void {
    registeredOrchestrator = undefined;
}

/**
 * Recompute invoice insurance target dates after amount/date upserts.
 * Uses the same credit-insurance refresh as API due-date edits.
 */
export async function refreshInsuranceTargetDatesViaHost(
    invoiceIds: number[],
    prisma: PrismaClient
): Promise<number> {
    if (invoiceIds.length === 0) {
        return 0;
    }
    bindCreditInsurancePrisma(prisma);
    return refreshInsuranceTargetDatesForInvoiceIds(invoiceIds, prisma);
}

/**
 * Default post-Invoice / payment-only AR post-ingest when the host does not
 * pass onArPostIngest (queue worker, scheduled sync, internal inline).
 */
export async function runArPostIngestViaHost(
    input: ArPostIngestHostInput,
    prisma: PrismaClient
): Promise<void> {
    bindCreditInsurancePrisma(prisma);

    if (!registeredOrchestrator) {
        throw new Error(
            "AR post-ingest orchestrator is not registered. Call registerArPostIngestOrchestrator(fn) during service startup, or pass onArPostIngest to the sync options."
        );
    }

    const result = await registeredOrchestrator({
        accountId: input.accountId,
        customerIds: input.customerIds,
        runReplay: input.runReplay === true,
        runMaturity: input.runMaturity === true,
        // Default true in Nest; only pass through when explicitly set.
        ...(input.runProcessOverdue !== undefined
            ? { runProcessOverdue: input.runProcessOverdue }
            : {}),
        runLiveRefresh: input.runLiveRefresh === true,
        enqueueAsOfRewrite: input.enqueueAsOfRewrite === true,
        dryRun: input.dryRun === true,
        asOfRewrite: input.asOfRewrite,
        ...(input.invoiceEntityIds?.length
            ? { affectedInvoiceIds: input.affectedInvoiceIds ?? input.invoiceEntityIds }
            : {}),
        ...(input.mepBreachStartDate !== undefined
            ? { mepBreachStartDate: input.mepBreachStartDate }
            : {}),
        ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    });

    for (const failure of result.errors ?? []) {
        console.error("[arPostIngestHost] post-ingest step failed", {
            accountId: input.accountId,
            step: failure.step,
            customerId: failure.customerId,
            message: failure.message,
            stack: failure.stack,
        });
    }

    // Match file-import: collection-only still enqueues as-of rewrite.
    if (
        result.skipped &&
        input.enqueueAsOfRewrite === true &&
        input.asOfRewrite
    ) {
        await enqueueRewriteForImport({
            accountId: input.accountId,
            importType: input.asOfRewrite.importType,
            entityIds: input.asOfRewrite.entityIds,
            customerIds: input.customerIds,
        });
    }
}

export type DeferredArPostIngestStep =
    | "replay"
    | "process_overdue"
    | "live_refresh";

/** Heavy CI steps deferred to the worker. Process Overdue is a separate sync tail step. */
export const DEFERRED_CI_POST_INGEST_STEPS: DeferredArPostIngestStep[] = [
    "replay",
    "live_refresh",
];

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
    schedulePostIngestDrain?: () => Promise<
        PostIngestDrainScheduleResult | void
    >;
};

/**
 * Once after Invoice entity completion. Best-effort: errors are logged and do
 * not fail the sync. Caller must skip on dry-run.
 */
export async function invokeConnectorArPostIngest(params: {
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
} & ConnectorPostIngestDeferOptions): Promise<{ deferred: boolean }> {
    const { customerIds, invoiceEntityIds, paymentEntityIds } = params;
    if (customerIds.length === 0) {
        return { deferred: false };
    }

    bindCreditInsurancePrisma(params.prisma);

    // Amount (and date) upserts must refresh insurance targets before replay
    // so sign flips apply even if later post-ingest steps are skipped.
    if (invoiceEntityIds.length > 0) {
        try {
            await refreshInsuranceTargetDatesViaHost(
                invoiceEntityIds,
                params.prisma
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            params.log(
                `Insurance target refresh after invoice upsert failed: ${message}`
            );
        }
    }

    const asOfRewrite =
        invoiceEntityIds.length > 0
            ? {
                  importType: "Invoice" as const,
                  entityIds: invoiceEntityIds,
              }
            : {
                  importType: "Payment" as const,
                  entityIds: paymentEntityIds,
              };

    const run =
        params.onArPostIngest ??
        ((input) => runArPostIngestViaHost(input, params.prisma));

    const runSteps = async (args: {
        label: string;
        runReplay: boolean;
        runProcessOverdue: boolean;
        runLiveRefresh: boolean;
        runMaturity: boolean;
        enqueueAsOfRewrite: boolean;
    }): Promise<void> => {
        params.log(
            `AR post-ingest ${args.label} for ${customerIds.length} customer(s)…`
        );
        try {
            await run({
                accountId: params.accountId,
                customerIds,
                runReplay: args.runReplay,
                runMaturity: args.runMaturity,
                runProcessOverdue: args.runProcessOverdue,
                runLiveRefresh: args.runLiveRefresh,
                enqueueAsOfRewrite: args.enqueueAsOfRewrite,
                ...(args.enqueueAsOfRewrite ? { asOfRewrite } : {}),
                ...(params.onProgress ? { onProgress: params.onProgress } : {}),
            });
            params.log(
                `AR post-ingest ${args.label} finished for ${customerIds.length} customer(s)`
            );
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "AR post-ingest failed";
            params.log(`AR post-ingest ${args.label} failed: ${message}`);
        }
    };

    const runProcessOverdue =
        params.runProcessOverdue !== undefined
            ? params.runProcessOverdue
            : true;

    if (params.deferPostIngest === true) {
        if (runProcessOverdue) {
            await runSteps({
                label: "process-overdue (inline fallback)",
                runReplay: false,
                runProcessOverdue: true,
                runLiveRefresh: false,
                runMaturity: params.runMaturity === true,
                enqueueAsOfRewrite: false,
            });
        }

        try {
            await enqueueRewriteForImport({
                accountId: params.accountId,
                importType: asOfRewrite.importType,
                entityIds: asOfRewrite.entityIds,
                customerIds,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            params.log(`As-of rewrite enqueue failed: ${message}`);
        }

        if (params.enqueueDeferredSteps) {
            await params.enqueueDeferredSteps({
                accountId: params.accountId,
                customerIds,
                steps: [...DEFERRED_CI_POST_INGEST_STEPS],
            });
        } else {
            params.log(
                "AR post-ingest defer requested but enqueueDeferredSteps is not configured"
            );
        }

        let drainQueued = false;
        let drainReason: string | undefined;
        if (params.schedulePostIngestDrain) {
            try {
                const drainResult = await params.schedulePostIngestDrain();
                drainQueued = drainResult?.queued === true;
                drainReason = drainResult?.reason;
            } catch (error) {
                drainReason =
                    error instanceof Error ? error.message : String(error);
                params.log(
                    `Failed to schedule AR post-ingest worker drain: ${drainReason}`
                );
            }
        } else {
            drainReason = "schedulePostIngestDrain is not configured";
        }

        if (!drainQueued) {
            params.log(
                `AR post-ingest drain not queued (${drainReason ?? "unknown"}); running replay/live-refresh inline`
            );
            await runSteps({
                label: "replay/live-refresh (inline fallback)",
                runReplay: true,
                runProcessOverdue: false,
                runLiveRefresh: true,
                runMaturity: false,
                enqueueAsOfRewrite: false,
            });
            return { deferred: false };
        }

        params.log(
            `Deferred replay/live-refresh for ${customerIds.length} customer(s) — worker will drain`
        );
        return { deferred: true };
    }

    await runSteps({
        label: "full",
        runReplay: true,
        runProcessOverdue,
        runLiveRefresh: true,
        runMaturity: params.runMaturity === true,
        enqueueAsOfRewrite: true,
    });
    return { deferred: false };
}
