/**
 * Single orchestration seam for scheduled due-sync and manual Sync now
 * (PRD D5/D10/D11/D18): drain blocking pending-customer-history before
 * incremental is allowed. Post-enqueue continue-drain is scheduled by hosts
 * after they release the RUNNING mutex (D12) — see
 * {@link scheduleContinuePendingCustomerHistoryDrainForAccount}.
 */

import type { PrismaClient } from "@prisma/client";
import {
    drainBlockingPendingCustomerHistory,
    scheduleContinuePendingCustomerHistoryDrain,
    type DrainPendingCustomerHistoryOptions,
    type DrainPendingCustomerHistoryResult,
} from "./pendingCustomerHistoryDrain";
import {
    runInProcessSync,
    type RunInProcessSyncOptions,
    type RunInProcessSyncResult,
} from "./runInProcessSync";

export type RunSyncWithPendingCustomerHistoryPolicyOptions =
    RunInProcessSyncOptions & {
        /** Override sync body (unit tests). */
        runSync?: (
            options: RunInProcessSyncOptions
        ) => Promise<RunInProcessSyncResult>;
        /** Override drain (unit tests). */
        drainBlocking?: (
            options: DrainPendingCustomerHistoryOptions
        ) => Promise<DrainPendingCustomerHistoryResult>;
    };

async function resolveConnectorMeta(
    prisma: PrismaClient,
    accountId: number
): Promise<{ connectorId: number; provider: string; syncMode: string } | null> {
    const connector = await prisma.billingConnector.findUnique({
        where: { account_id: accountId },
        select: { id: true, provider: true, sync_mode: true },
    });
    if (!connector) {
        return null;
    }
    return {
        connectorId: connector.id,
        provider: connector.provider,
        syncMode: connector.sync_mode,
    };
}

export function buildPendingCustomerHistoryDrainOptions(
    options: RunInProcessSyncOptions,
    meta: { connectorId: number; provider: string; syncMode: string }
): DrainPendingCustomerHistoryOptions {
    return {
        prisma: options.prisma,
        accountId: options.accountId,
        connectorId: meta.connectorId,
        provider: meta.provider,
        syncMode:
            meta.syncMode === "INCREMENTAL" ? "INCREMENTAL" : meta.syncMode,
        trigger: "pending_customer_history",
        executionId: options.executionId ?? null,
        correlationId: options.observability?.correlationId ?? null,
        onLog: options.onLog,
        store: options.pendingCustomerHistoryQueueStore,
        syncOptions: {
            userId: options.userId,
            dryRun: options.dryRun,
            customerScopedHistoryProgressStore:
                options.customerScopedHistoryProgressStore,
            provider: options.provider,
            skipConnectionTest: options.skipConnectionTest,
            resolveExtension: options.resolveExtension,
            importBatch: options.importBatch,
            onProgress: options.onProgress,
            onCustomerBalancesFinal: options.onCustomerBalancesFinal,
            onArPostIngest: options.onArPostIngest,
            onProcessOverdueCustomers: options.onProcessOverdueCustomers,
            observability: options.observability,
            mepBreachStartDate: options.mepBreachStartDate,
            deferPostIngest: options.deferPostIngest,
            enqueueDeferredSteps: options.enqueueDeferredSteps,
            schedulePostIngestDrain: options.schedulePostIngestDrain,
        },
    };
}

/**
 * Shared entry for incremental paths: drain blocking history first, then run
 * incremental. Does not await post-enqueue drain (hosts schedule that after
 * releasing RUNNING — D12).
 */
export async function runSyncWithPendingCustomerHistoryPolicy(
    options: RunSyncWithPendingCustomerHistoryPolicyOptions
): Promise<RunInProcessSyncResult> {
    const runSync = options.runSync ?? runInProcessSync;
    const drainBlocking =
        options.drainBlocking ?? drainBlockingPendingCustomerHistory;

    if (options.mode !== "incremental" || options.dryRun) {
        return runSync(options);
    }

    const meta = await resolveConnectorMeta(options.prisma, options.accountId);
    if (!meta) {
        return runSync(options);
    }

    // Only gate incremental while the account is already on INCREMENTAL.
    // Account-wide BACKFILL onboard must not divert into this drain.
    if (meta.syncMode !== "INCREMENTAL") {
        return runSync(options);
    }

    const drainResult = await drainBlocking(
        buildPendingCustomerHistoryDrainOptions(options, meta)
    );
    if (drainResult.cancelled) {
        return {
            ok: false,
            accountId: options.accountId,
            provider: meta.provider,
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
            message:
                "Stopped by operator during pending customer history drain",
            error: "cancelled",
            cancelled: true,
        };
    }
    // D11: do not start incremental while blocking rows remain (should be
    // empty after a full drain unless cancel raced).
    if (drainResult.remainingBlocking > 0) {
        return {
            ok: false,
            accountId: options.accountId,
            provider: meta.provider,
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
            message: `Pending customer history still blocking incremental (${drainResult.remainingBlocking} row(s))`,
            error: "PENDING_HISTORY_BLOCKING",
        };
    }

    return runSync(options);
}

export type ScheduleContinuePendingCustomerHistoryDrainForAccountParams = {
    prisma: PrismaClient;
    accountId: number;
    onLog?: (message: string) => void;
    executionId?: string | null;
    correlationId?: string | null;
    store?: RunInProcessSyncOptions["pendingCustomerHistoryQueueStore"];
    syncOptions?: DrainPendingCustomerHistoryOptions["syncOptions"];
};

/**
 * Fire-and-forget drain after incremental + enqueue finished and the host
 * released the in-process RUNNING registry (and preferably Mongo finalize).
 */
export async function scheduleContinuePendingCustomerHistoryDrainForAccount(
    params: ScheduleContinuePendingCustomerHistoryDrainForAccountParams
): Promise<void> {
    const meta = await resolveConnectorMeta(params.prisma, params.accountId);
    if (!meta || meta.syncMode !== "INCREMENTAL") {
        return;
    }
    scheduleContinuePendingCustomerHistoryDrain({
        prisma: params.prisma,
        accountId: params.accountId,
        connectorId: meta.connectorId,
        provider: meta.provider,
        syncMode: "INCREMENTAL",
        trigger: "pending_customer_history",
        executionId: params.executionId ?? null,
        correlationId: params.correlationId ?? null,
        onLog: params.onLog,
        store: params.store,
        syncOptions: params.syncOptions,
    });
}
