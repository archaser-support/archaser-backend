"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncDueBillingConnectors = syncDueBillingConnectors;
const crypto_1 = require("crypto");
const billingConnectorSchedule_1 = require("./billingConnectorSchedule");
const runInProcessSync_1 = require("../sync/runInProcessSync");
const syncHistory_1 = require("../syncHistory");
const finalizeSyncHistoryAfterRun_1 = require("../syncHistory/finalizeSyncHistoryAfterRun");
const MAX_CONNECTORS_PER_RUN = Number.parseInt(process.env.BILLING_CONNECTOR_MAX_CONNECTORS_PER_RUN ?? "5", 10);
/**
 * Cron entry: sync due Active+enabled billing connectors (Stage 2).
 * Uses in-process Priority sync (D71) until connectors path flip owns schedules (D65/D72).
 *
 * Persists each run to Mongo sync history (`trigger: scheduled`) via shared
 * syncHistory helpers. Requires `MONGODB_URI` in the cron/API process env
 * (same default as Nest: mongodb://localhost:27017/archaser).
 */
async function syncDueBillingConnectors(prisma, options) {
    const start = Date.now();
    const results = [];
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    const skippedFrozenAccountIds = new Set();
    const runSync = options?.runSync ?? runInProcessSync_1.runInProcessSync;
    const createExecutionId = options?.createExecutionId ?? crypto_1.randomUUID;
    const now = options?.now ?? new Date();
    const connectors = await prisma.billingConnector.findMany({
        where: {
            sync_enabled: true,
            status: "Active",
        },
        orderBy: [{ sync_mode: "asc" }, { modified_at: "asc" }],
        take: MAX_CONNECTORS_PER_RUN,
    });
    for (const connector of connectors) {
        if (options?.excludeAccountIds?.has(connector.account_id)) {
            skipped += 1;
            skippedFrozenAccountIds.add(connector.account_id);
            continue;
        }
        if (connector.sync_mode === "INCREMENTAL") {
            const lastSuccess = await prisma.connectorSyncState.findFirst({
                where: {
                    connector_id: connector.id,
                    last_successful_run_at: { not: null },
                },
                orderBy: { last_successful_run_at: "desc" },
                select: { last_successful_run_at: true },
            });
            const due = (0, billingConnectorSchedule_1.isConnectorDue)({
                syncMode: "INCREMENTAL",
                syncCronExpression: connector.sync_cron_expression,
                now,
                lastScheduledIncrementalSuccessAt: lastSuccess?.last_successful_run_at ?? null,
                hasScheduledIncrementalSuccess: !!lastSuccess?.last_successful_run_at,
                connectorModifiedAt: connector.modified_at,
            });
            if (!due) {
                skipped += 1;
                continue;
            }
        }
        const executionId = createExecutionId();
        const startedAt = new Date();
        try {
            await (0, syncHistory_1.createRunningExecution)({
                executionId,
                accountId: connector.account_id,
                connectorId: connector.id,
                provider: connector.provider,
                trigger: "scheduled",
                syncMode: connector.sync_mode,
                startedAt,
            });
        }
        catch {
            // History write must not block the sync (same as Nest accept path).
        }
        try {
            const heartbeat = (0, syncHistory_1.createSyncProgressHeartbeat)(executionId);
            const result = await runSync({
                prisma,
                accountId: connector.account_id,
                trigger: "scheduled",
                executionId,
                onLog: options?.onLog,
                observability: options?.observability,
                onProgress: (entityStats) => {
                    void heartbeat(entityStats);
                },
            });
            results.push(result);
            processed += 1;
            if (!result.ok)
                failed += 1;
            const completedAt = new Date();
            try {
                await (0, finalizeSyncHistoryAfterRun_1.finalizeSyncHistoryAfterRun)(executionId, result, completedAt);
            }
            catch {
                // Best-effort history complete.
            }
        }
        catch (error) {
            failed += 1;
            processed += 1;
            const message = error instanceof Error ? error.message : String(error);
            try {
                await (0, finalizeSyncHistoryAfterRun_1.finalizeSyncHistoryAfterRun)(executionId, {
                    ok: false,
                    accountId: connector.account_id,
                    provider: connector.provider,
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
                }, new Date());
            }
            catch {
                // Best-effort history complete; hard crash leaves RUNNING for sweeper.
            }
        }
    }
    try {
        await (0, syncHistory_1.sweepStaleRunning)({
            olderThanHours: 2,
            completedAt: now,
        });
    }
    catch {
        // Best-effort stale sweep (Nest /sync-history also sweeps on read).
    }
    const durationMs = Date.now() - start;
    const message = `Billing connector sync: ${processed} processed, ${skipped} skipped, ${failed} failed`;
    return {
        success: failed === 0,
        message,
        processed,
        skipped,
        failed,
        skippedFrozenAccountIds: [...skippedFrozenAccountIds].sort((a, b) => a - b),
        results,
        durationMs,
    };
}
