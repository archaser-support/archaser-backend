import type { PrismaClient } from "@prisma/client";
import {
    clearRunningSync,
    getRunningSync,
    listSyncRuns,
    patchSyncRunProgress,
    registerRunningSync,
    upsertSyncRun,
    type ConnectorSyncRunSummary,
    type RunningConnectorSync,
} from "./connectorSyncRuntime";
import {
    isConnectorSyncCancelRequested,
    requestConnectorSyncCancel,
} from "./connectorSyncCancelRegistry";
import {
    runInProcessSync,
    type RunInProcessSyncOptions,
    type RunInProcessSyncResult,
} from "./runInProcessSync";
import {
    createRunningExecution,
    createSyncProgressHeartbeat,
    finalizeSyncHistoryAfterRun,
    listExecutionsForAccount,
    markExecutionCancelled,
    sweepStaleRunning,
    syncHistoryExecutionToSummary,
} from "../syncHistory";
import {
    resolveSyncErrorType,
    resolveSyncExecutionStatus,
} from "../observability/statusAndErrorType";

export type RegisterAcceptedInProcessSyncParams = {
    accountId: number;
    executionId: string;
    startedAt: Date;
    mode: "backfill" | "incremental" | "preview";
    trigger: string;
    runningSummary: ConnectorSyncRunSummary;
};

export function registerAcceptedInProcessSync(
    params: RegisterAcceptedInProcessSyncParams
): RunningConnectorSync {
    const running: RunningConnectorSync = {
        accountId: params.accountId,
        executionId: params.executionId,
        startedAt: params.startedAt,
        mode: params.mode,
        trigger: params.trigger,
    };
    registerRunningSync(running);
    return running;
}

export async function createInProcessSyncHistoryStub(params: {
    executionId: string;
    accountId: number;
    connectorId: number;
    provider: string;
    trigger: "backfill" | "manual";
    syncMode: string;
    startedAt: Date;
    onError?: (message: string) => void;
}): Promise<void> {
    try {
        await createRunningExecution({
            executionId: params.executionId,
            accountId: params.accountId,
            connectorId: params.connectorId,
            provider: params.provider,
            trigger: params.trigger,
            syncMode: params.syncMode,
            startedAt: params.startedAt,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.onError?.(
            `[account ${params.accountId}] Failed to create sync history stub ${params.executionId}: ${message}`
        );
    }
}

export type RunAcceptedInProcessSyncParams = {
    prisma: PrismaClient;
    accountId: number;
    executionId: string;
    mode: "backfill" | "incremental";
    trigger: string;
    userId?: string;
    runningSummary: ConnectorSyncRunSummary;
    onLog: (message: string) => void;
    onError?: (message: string) => void;
} & Pick<
    RunInProcessSyncOptions,
    | "observability"
    | "onCustomerBalancesFinal"
    | "onProcessOverdueCustomers"
    | "onArPostIngest"
    | "deferPostIngest"
    | "enqueueDeferredSteps"
    | "schedulePostIngestDrain"
>;

export async function runAcceptedInProcessSync(
    params: RunAcceptedInProcessSyncParams
): Promise<void> {
    const {
        accountId,
        executionId,
        mode,
        trigger,
        runningSummary,
        onLog,
        onError,
        prisma,
        userId,
        ...runOptions
    } = params;
    try {
        const heartbeat = createSyncProgressHeartbeat(executionId);
        const result = await runInProcessSync({
            prisma,
            accountId,
            trigger,
            userId,
            executionId,
            mode,
            onLog,
            onProgress: (patch) => {
                patchSyncRunProgress(
                    accountId,
                    executionId,
                    patch,
                    runningSummary
                );
                void heartbeat(patch.entity_stats);
            },
            ...runOptions,
        });
        await finalizeAcceptedInProcessSyncRun({
            accountId,
            executionId,
            mode,
            runningSummary,
            result,
            onLog,
            onError,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(`[account ${accountId}] ${mode} crashed: ${message}`);
        const completedAt = new Date();
        upsertSyncRun(accountId, {
            ...runningSummary,
            status: "FAILED",
            completed_at: completedAt.toISOString(),
            duration_seconds: durationSecondsSince(
                runningSummary.started_at,
                completedAt
            ),
            error_message: message,
            error_type: "unexpected",
        });
        try {
            await finalizeSyncHistoryAfterRun(
                executionId,
                {
                    ok: false,
                    accountId,
                    provider: runningSummary.sync_mode,
                    stats: emptySyncStats(),
                    message,
                    error: message,
                },
                completedAt
            );
        } catch (historyError) {
            const historyMessage =
                historyError instanceof Error
                    ? historyError.message
                    : String(historyError);
            onError?.(
                `[account ${accountId}] Failed to complete sync history ${executionId}: ${historyMessage}`
            );
        }
    } finally {
        clearRunningSync(accountId);
    }
}

async function finalizeAcceptedInProcessSyncRun(params: {
    accountId: number;
    executionId: string;
    mode: string;
    runningSummary: ConnectorSyncRunSummary;
    result: RunInProcessSyncResult;
    onLog: (message: string) => void;
    onError?: (message: string) => void;
}): Promise<void> {
    const {
        accountId,
        executionId,
        mode,
        runningSummary,
        result,
        onLog,
        onError,
    } = params;
    const completedAt = new Date();
    const status = resolveSyncExecutionStatus(result) as
        | "SUCCESS"
        | "FAILED"
        | "PARTIAL"
        | "TIMEOUT";
    const errorType =
        resolveSyncErrorType(result, status) ?? (result.error ?? null);
    onLog(
        result.postIngestDeferred
            ? `Entity ingest finished; awaiting post-import drain (${status})`
            : `Finished ${mode}: ${status}${
                  result.error ? ` — ${result.error}` : ""
              }`
    );
    upsertSyncRun(accountId, {
        ...runningSummary,
        status: result.postIngestDeferred ? "RUNNING" : status,
        completed_at: result.postIngestDeferred
            ? null
            : completedAt.toISOString(),
        duration_seconds: result.postIngestDeferred
            ? null
            : durationSecondsSince(runningSummary.started_at, completedAt),
        entity_stats: result.entity_stats ?? {},
        error_message: result.postIngestDeferred ? null : result.error ?? null,
        error_type: result.postIngestDeferred ? null : errorType,
    });
    try {
        await finalizeSyncHistoryAfterRun(executionId, result, completedAt);
    } catch (historyError) {
        const historyMessage =
            historyError instanceof Error
                ? historyError.message
                : String(historyError);
        onError?.(
            `[account ${accountId}] Failed to complete sync history ${executionId}: ${historyMessage}`
        );
    }
}

export async function cancelInProcessSyncRun(params: {
    accountId: number;
    onError?: (message: string) => void;
}): Promise<{ cancelled: boolean; execution_id: string | null }> {
    const running = getRunningSync(params.accountId);
    if (!running) {
        try {
            const mongoRuns = await listExecutionsForAccount(params.accountId, {
                limit: 10,
            });
            const orphan = mongoRuns.find((doc) => doc.status === "RUNNING");
            if (!orphan) {
                return { cancelled: false, execution_id: null };
            }
            const cancelledAt = new Date();
            await markExecutionCancelled(orphan.execution_id, {
                errorMessage: "Sync stopped by operator",
            });
            upsertSyncRun(params.accountId, {
                id: orphan.execution_id,
                trigger: orphan.trigger,
                sync_mode: orphan.sync_mode,
                status: "TIMEOUT",
                started_at: orphan.started_at.toISOString(),
                completed_at: cancelledAt.toISOString(),
                duration_seconds: durationSecondsSince(
                    orphan.started_at.toISOString(),
                    cancelledAt
                ),
                entity_stats: orphan.entity_stats ?? {},
                error_message: "Sync stopped by operator",
                error_type: "cancelled",
                cutover_options: null,
                cutover_summary: null,
            });
            return {
                cancelled: true,
                execution_id: orphan.execution_id,
            };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            params.onError?.(
                `[account ${params.accountId}] Failed to cancel orphan sync run: ${message}`
            );
            return { cancelled: false, execution_id: null };
        }
    }
    requestConnectorSyncCancel(running.executionId);
    const cancelledAt = new Date();
    const existing = listSyncRuns(params.accountId).find(
        (run) => run.id === running.executionId
    );
    if (existing) {
        upsertSyncRun(params.accountId, {
            ...existing,
            status: "TIMEOUT",
            completed_at: cancelledAt.toISOString(),
            duration_seconds: durationSecondsSince(
                existing.started_at,
                cancelledAt
            ),
            error_message: "Sync stopped by operator",
            error_type: "cancelled",
        });
    }
    try {
        await markExecutionCancelled(running.executionId, {
            errorMessage: "Sync stopped by operator",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.onError?.(
            `[account ${params.accountId}] Failed to mark sync history cancelled ${running.executionId}: ${message}`
        );
    }
    return { cancelled: true, execution_id: running.executionId };
}

export async function listMergedInProcessSyncRuns(
    accountId: number,
    limitRaw?: number,
    onWarn?: (message: string) => void
): Promise<ConnectorSyncRunSummary[]> {
    const limit = Number.isFinite(limitRaw) ? (limitRaw as number) : 25;
    const memoryRuns = listSyncRuns(accountId, limit);
    const inProcess = getRunningSync(accountId);
    try {
        const mongoRuns = await listExecutionsForAccount(accountId, {
            limit: Math.max(limit, 25),
        });
        const activeFromMongo = mongoRuns
            .filter((doc) => doc.status === "RUNNING")
            .map(syncHistoryExecutionToSummary)
            // Mongo RUNNING without a matching in-process worker is stale
            // (process restart, completed worker, or missed cancel).
            .filter(
                (run) =>
                    inProcess != null && run.id === inProcess.executionId
            );
        if (activeFromMongo.length === 0) {
            return memoryRuns;
        }
        const byId = new Map(memoryRuns.map((run) => [run.id, run]));
        for (const run of activeFromMongo) {
            const existing = byId.get(run.id);
            if (
                existing?.completed_at ||
                (existing?.status === "TIMEOUT" &&
                    existing?.error_type === "cancelled")
            ) {
                continue;
            }
            // Prefer in-memory live progress over Mongo. Heartbeats only flush
            // entity_stats about every 60s, so Mongo-first merge made the panel
            // show stale/zero counts (e.g. "0 processed") while a tail step ran.
            byId.set(run.id, {
                ...run,
                ...(existing ?? {}),
                cutover_options:
                    existing?.cutover_options ?? run.cutover_options,
                cutover_summary:
                    existing?.cutover_summary ?? run.cutover_summary,
            });
        }
        return Array.from(byId.values()).sort(
            (a, b) =>
                new Date(b.started_at).getTime() -
                new Date(a.started_at).getTime()
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onWarn?.(
            `[account ${accountId}] Failed to merge Mongo sync runs: ${message}`
        );
        return memoryRuns;
    }
}

export async function listDurableSyncHistoryRuns(
    accountId: number,
    onError?: (message: string) => void
): Promise<ConnectorSyncRunSummary[]> {
    try {
        await sweepStaleRunning({ accountId, olderThanHours: 2 });
        const docs = await listExecutionsForAccount(accountId);
        return docs.map(syncHistoryExecutionToSummary);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError?.(
            `[account ${accountId}] Failed to list sync history: ${message}`
        );
        throw error;
    }
}

export function isInProcessSyncCancelRequested(executionId: string): boolean {
    return isConnectorSyncCancelRequested(executionId);
}

function durationSecondsSince(startedAt: string, completedAt: Date): number {
    return Math.max(
        1,
        Math.round(
            (completedAt.getTime() - new Date(startedAt).getTime()) / 1000
        )
    );
}

function emptySyncStats() {
    return {
        customersProcessed: 0,
        contactsProcessed: 0,
        invoicesProcessed: 0,
        paymentsProcessed: 0,
        customersImported: 0,
        contactsImported: 0,
        invoicesImported: 0,
        paymentsImported: 0,
        importErrors: 0,
    };
}
