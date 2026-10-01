/**
 * Drain blocking pending-customer-history rows sequentially with the same
 * customer-scoped history path as Start backfill (mode=backfill + customerId).
 * Account sync_mode stays INCREMENTAL (isolated progress / reconcile).
 */

import { randomUUID } from "crypto";
import type { PrismaClient } from "@prisma/client";
import {
    buildBaseLogFields,
    formatBillingConnectorSyncLogLine,
} from "../observability/structuredLog";
import {
    clearRunningSync,
    getRunningSync,
    registerRunningSync,
} from "./connectorSyncRuntime";
import { isConnectorSyncCancelRequested } from "./connectorSyncCancelRegistry";
import {
    createRunningExecution,
    finalizeSyncHistoryAfterRun,
    isSyncAlreadyRunningError,
} from "../syncHistory";
import {
    runInProcessSync,
    type RunInProcessSyncOptions,
    type RunInProcessSyncResult,
} from "./runInProcessSync";
import {
    clearPendingCustomerHistoryOnSuccess,
    listBlockingPendingCustomerHistory,
    markPendingCustomerHistoryInProgress,
    PENDING_CUSTOMER_HISTORY_MAX_ATTEMPTS,
    recordPendingCustomerHistoryFailure,
    revertPendingCustomerHistoryToPending,
    type PendingCustomerHistoryQueueStore,
    type PendingCustomerHistoryRow,
} from "./pendingCustomerHistoryQueue";

export type DrainPendingCustomerHistoryOptions = {
    prisma: PrismaClient;
    accountId: number;
    connectorId: number;
    provider: string;
    /** Parent sync mode label for logs (account stays INCREMENTAL). */
    syncMode?: string;
    trigger?: string;
    executionId?: string | null;
    correlationId?: string | null;
    onLog?: (message: string) => void;
    store?: PendingCustomerHistoryQueueStore;
    maxAttempts?: number;
    /**
     * Run one customer-scoped history load. Defaults to runInProcessSync with
     * mode=backfill + customerId (no clear-before-import).
     */
    runCustomerHistory?: (
        options: RunInProcessSyncOptions
    ) => Promise<RunInProcessSyncResult>;
    /** Passthrough host hooks for nested customer-history syncs. */
    syncOptions?: Omit<
        RunInProcessSyncOptions,
        | "prisma"
        | "accountId"
        | "mode"
        | "customerId"
        | "clearBeforeImport"
        | "executionId"
        | "trigger"
        | "onLog"
        | "pendingCustomerHistoryQueueStore"
    >;
};

export type DrainPendingCustomerHistoryResult = {
    attempted: number;
    succeeded: number;
    failed: number;
    needsAttention: number;
    cancelled: boolean;
    remainingBlocking: number;
};

function emitDrainLog(input: {
    accountId: number;
    connectorId: number;
    provider: string;
    syncMode: string;
    trigger: string;
    status: string;
    executionId?: string | null;
    correlationId?: string | null;
    customerId?: number | null;
    message: string;
    onLog?: (message: string) => void;
    errorType?: string | null;
}): void {
    const line = formatBillingConnectorSyncLogLine(
        buildBaseLogFields({
            accountId: input.accountId,
            connectorId: input.connectorId,
            provider: input.provider,
            syncMode: input.syncMode,
            trigger: input.trigger,
            status: input.status,
            errorType: input.errorType ?? null,
            executionId: input.executionId,
            correlationId: input.correlationId,
            customerId: input.customerId,
            message: input.message,
        })
    );
    if (input.onLog) {
        input.onLog(line);
        return;
    }
    console.log(line);
}

function failureMessage(result: RunInProcessSyncResult): string {
    return (
        result.error ??
        result.message ??
        "Customer-scoped history failed"
    ).slice(0, 2000);
}

/**
 * Process all blocking (pending/in_progress) rows sequentially. One hard
 * failure does not stop the rest; after maxAttempts the row becomes
 * needs_attention and no longer blocks.
 */
export async function drainBlockingPendingCustomerHistory(
    options: DrainPendingCustomerHistoryOptions
): Promise<DrainPendingCustomerHistoryResult> {
    const syncMode = options.syncMode ?? "INCREMENTAL";
    const trigger = options.trigger ?? "pending_customer_history";
    const maxAttempts =
        options.maxAttempts ?? PENDING_CUSTOMER_HISTORY_MAX_ATTEMPTS;
    const runCustomerHistory = options.runCustomerHistory ?? runInProcessSync;
    const log = options.onLog;

    const initial = await listBlockingPendingCustomerHistory(
        options.connectorId,
        options.store
    );
    const summary: DrainPendingCustomerHistoryResult = {
        attempted: 0,
        succeeded: 0,
        failed: 0,
        needsAttention: 0,
        cancelled: false,
        remainingBlocking: initial.length,
    };

    if (initial.length === 0) {
        return summary;
    }

    emitDrainLog({
        accountId: options.accountId,
        connectorId: options.connectorId,
        provider: options.provider,
        syncMode,
        trigger,
        status: "PENDING_HISTORY_DRAIN_START",
        executionId: options.executionId,
        correlationId: options.correlationId,
        message: `Pending customer history drain starting (${initial.length} blocking row(s))`,
        onLog: log,
    });

    // Drain until no blocking rows remain (failed rows retry until
    // needs_attention after maxAttempts, then stop blocking).
    for (;;) {
        if (
            options.executionId &&
            isConnectorSyncCancelRequested(options.executionId)
        ) {
            summary.cancelled = true;
            break;
        }

        const blocking = await listBlockingPendingCustomerHistory(
            options.connectorId,
            options.store
        );
        if (blocking.length === 0) {
            summary.remainingBlocking = 0;
            break;
        }
        const next = blocking[0]!;
        summary.attempted += 1;

        const outcome = await drainOnePendingCustomerHistory({
            row: next,
            options,
            syncMode,
            trigger,
            maxAttempts,
            runCustomerHistory,
        });
        if (outcome === "cancelled") {
            summary.cancelled = true;
            break;
        }
        if (outcome === "success") {
            summary.succeeded += 1;
        } else if (outcome === "needs_attention") {
            summary.failed += 1;
            summary.needsAttention += 1;
        } else {
            summary.failed += 1;
        }
    }

    const remaining = await listBlockingPendingCustomerHistory(
        options.connectorId,
        options.store
    );
    summary.remainingBlocking = remaining.length;

    emitDrainLog({
        accountId: options.accountId,
        connectorId: options.connectorId,
        provider: options.provider,
        syncMode,
        trigger,
        status: "PENDING_HISTORY_DRAIN_FINISH",
        executionId: options.executionId,
        correlationId: options.correlationId,
        message: `Pending customer history drain finished (attempted=${summary.attempted} succeeded=${summary.succeeded} failed=${summary.failed} needs_attention=${summary.needsAttention} remaining_blocking=${summary.remainingBlocking} cancelled=${summary.cancelled})`,
        onLog: log,
    });

    return summary;
}

async function drainOnePendingCustomerHistory(params: {
    row: PendingCustomerHistoryRow;
    options: DrainPendingCustomerHistoryOptions;
    syncMode: string;
    trigger: string;
    maxAttempts: number;
    runCustomerHistory: (
        options: RunInProcessSyncOptions
    ) => Promise<RunInProcessSyncResult>;
}): Promise<"success" | "failed" | "needs_attention" | "cancelled"> {
    const { row, options, syncMode, trigger, maxAttempts, runCustomerHistory } =
        params;

    await markPendingCustomerHistoryInProgress({
        connectorId: options.connectorId,
        customerId: row.customer_id,
        store: options.store,
    });

    let result: RunInProcessSyncResult;
    try {
        result = await runCustomerHistory({
            ...options.syncOptions,
            prisma: options.prisma,
            accountId: options.accountId,
            mode: "backfill",
            customerId: row.customer_id,
            // Auto history for new customers — no clear-before-import.
            trigger,
            executionId: options.executionId ?? undefined,
            onLog: options.onLog,
            ...(options.store
                ? { pendingCustomerHistoryQueueStore: options.store }
                : {}),
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        return applyHardFailure({
            options,
            row,
            syncMode,
            trigger,
            maxAttempts,
            errorMessage: message,
        });
    }

    if (result.cancelled) {
        await revertPendingCustomerHistoryToPending({
            connectorId: options.connectorId,
            customerId: row.customer_id,
            store: options.store,
        });
        emitDrainLog({
            accountId: options.accountId,
            connectorId: options.connectorId,
            provider: options.provider,
            syncMode,
            trigger,
            status: "PENDING_HISTORY_CUSTOMER_CANCELLED",
            executionId: options.executionId,
            correlationId: options.correlationId,
            customerId: row.customer_id,
            message: `Pending customer history cancelled for customer_id=${row.customer_id}`,
            onLog: options.onLog,
        });
        return "cancelled";
    }

    if (result.ok) {
        await clearPendingCustomerHistoryOnSuccess({
            connectorId: options.connectorId,
            customerId: row.customer_id,
            store: options.store,
        });
        emitDrainLog({
            accountId: options.accountId,
            connectorId: options.connectorId,
            provider: options.provider,
            syncMode,
            trigger,
            status: "PENDING_HISTORY_CUSTOMER_SUCCESS",
            executionId: options.executionId,
            correlationId: options.correlationId,
            customerId: row.customer_id,
            message: `Pending customer history succeeded for customer_id=${row.customer_id} customer_number=${row.customer_number}`,
            onLog: options.onLog,
        });
        return "success";
    }

    return applyHardFailure({
        options,
        row,
        syncMode,
        trigger,
        maxAttempts,
        errorMessage: failureMessage(result),
    });
}

async function applyHardFailure(params: {
    options: DrainPendingCustomerHistoryOptions;
    row: PendingCustomerHistoryRow;
    syncMode: string;
    trigger: string;
    maxAttempts: number;
    errorMessage: string;
}): Promise<"failed" | "needs_attention"> {
    const { options, row, syncMode, trigger, maxAttempts, errorMessage } =
        params;
    const recorded = await recordPendingCustomerHistoryFailure({
        connectorId: options.connectorId,
        customerId: row.customer_id,
        error: errorMessage,
        maxAttempts,
        store: options.store,
    });

    emitDrainLog({
        accountId: options.accountId,
        connectorId: options.connectorId,
        provider: options.provider,
        syncMode,
        trigger,
        status: "PENDING_HISTORY_CUSTOMER_FAILED",
        executionId: options.executionId,
        correlationId: options.correlationId,
        customerId: row.customer_id,
        errorType: "unexpected",
        message: `Pending customer history failed for customer_id=${row.customer_id} attempt=${recorded.row?.attempt_count ?? "?"} error=${errorMessage.slice(0, 300)}`,
        onLog: options.onLog,
    });

    if (recorded.needsAttention) {
        emitDrainLog({
            accountId: options.accountId,
            connectorId: options.connectorId,
            provider: options.provider,
            syncMode,
            trigger,
            status: "PENDING_HISTORY_NEEDS_ATTENTION",
            executionId: options.executionId,
            correlationId: options.correlationId,
            customerId: row.customer_id,
            errorType: "unexpected",
            message: `Pending customer history needs_attention for customer_id=${row.customer_id} after ${maxAttempts} failures`,
            onLog: options.onLog,
        });
        return "needs_attention";
    }
    return "failed";
}

const continueDrainInFlight = new Set<number>();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After incremental + enqueue, continue draining without holding the caller.
 * Waits for the in-process RUNNING registry to clear, takes the Mongo +
 * in-process mutex, then drains remaining blocking rows (D12).
 */
export function scheduleContinuePendingCustomerHistoryDrain(
    options: DrainPendingCustomerHistoryOptions
): void {
    if (continueDrainInFlight.has(options.accountId)) {
        return;
    }
    continueDrainInFlight.add(options.accountId);
    void (async () => {
        const accountId = options.accountId;
        let ownedExecutionId: string | null = null;
        try {
            for (let i = 0; i < 200; i += 1) {
                if (!getRunningSync(accountId)) {
                    break;
                }
                await sleep(50);
            }
            // Brief yield so Mongo finalize can release the RUNNING mutex.
            await sleep(150);

            const blocking = await listBlockingPendingCustomerHistory(
                options.connectorId,
                options.store
            );
            if (blocking.length === 0) {
                return;
            }

            if (getRunningSync(accountId)) {
                return;
            }

            const executionId = randomUUID();
            const startedAt = new Date();
            try {
                await createRunningExecution({
                    executionId,
                    accountId,
                    connectorId: options.connectorId,
                    provider: options.provider,
                    trigger: "manual",
                    syncMode: "INCREMENTAL",
                    startedAt,
                });
            } catch (error) {
                if (isSyncAlreadyRunningError(error)) {
                    return;
                }
                // History stub failure must not block drain.
            }
            ownedExecutionId = executionId;
            registerRunningSync({
                accountId,
                executionId,
                startedAt,
                mode: "backfill",
                trigger: "pending_customer_history",
            });

            const drainResult = await drainBlockingPendingCustomerHistory({
                ...options,
                executionId,
                trigger: "pending_customer_history",
            });

            try {
                await finalizeSyncHistoryAfterRun(
                    executionId,
                    {
                        ok: !drainResult.cancelled && drainResult.failed === 0,
                        accountId,
                        provider: options.provider,
                        stats: {
                            customersProcessed: 0,
                            contactsProcessed: 0,
                            invoicesProcessed: 0,
                            paymentsProcessed: 0,
                            customersImported: 0,
                            contactsImported: 0,
                            invoicesImported: 0,
                            paymentsImported: 0,
                            importErrors: drainResult.failed,
                        },
                        message: `Pending customer history continue-drain finished (succeeded=${drainResult.succeeded} failed=${drainResult.failed} needs_attention=${drainResult.needsAttention})`,
                        ...(drainResult.cancelled
                            ? { cancelled: true, error: "cancelled" }
                            : drainResult.failed > 0
                              ? { error: "PENDING_HISTORY_DRAIN_PARTIAL" }
                              : {}),
                    },
                    new Date()
                );
            } catch {
                // Best-effort history complete.
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            emitDrainLog({
                accountId: options.accountId,
                connectorId: options.connectorId,
                provider: options.provider,
                syncMode: options.syncMode ?? "INCREMENTAL",
                trigger: "pending_customer_history",
                status: "PENDING_HISTORY_DRAIN_CONTINUE_FAILED",
                executionId: ownedExecutionId ?? options.executionId,
                correlationId: options.correlationId,
                errorType: "unexpected",
                message: `Pending customer history continue-drain failed: ${message.slice(0, 300)}`,
                onLog: options.onLog,
            });
            if (ownedExecutionId) {
                try {
                    await finalizeSyncHistoryAfterRun(
                        ownedExecutionId,
                        {
                            ok: false,
                            accountId,
                            provider: options.provider,
                            stats: {
                                customersProcessed: 0,
                                contactsProcessed: 0,
                                invoicesProcessed: 0,
                                paymentsProcessed: 0,
                                customersImported: 0,
                                contactsImported: 0,
                                invoicesImported: 0,
                                paymentsImported: 0,
                                importErrors: 0,
                            },
                            message,
                            error: message,
                        },
                        new Date()
                    );
                } catch {
                    // Best-effort
                }
            }
        } finally {
            clearRunningSync(accountId);
            continueDrainInFlight.delete(accountId);
        }
    })();
}
