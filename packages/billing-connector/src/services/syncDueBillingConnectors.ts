import type { PrismaClient } from "@prisma/client";
import { isConnectorDue } from "./billingConnectorSchedule";
import {
    runInProcessSync,
    type RunInProcessSyncResult,
} from "../sync/runInProcessSync";

const MAX_CONNECTORS_PER_RUN = Number.parseInt(
    process.env.BILLING_CONNECTOR_MAX_CONNECTORS_PER_RUN ?? "5",
    10
);

export interface SyncDueBillingConnectorsResult {
    success: boolean;
    message: string;
    processed: number;
    skipped: number;
    failed: number;
    results: RunInProcessSyncResult[];
    durationMs: number;
}

/**
 * Cron entry: sync due Active+enabled billing connectors (Stage 2).
 * Uses in-process Priority sync (D71) until connectors path flip owns schedules (D65/D72).
 */
export async function syncDueBillingConnectors(
    prisma: PrismaClient
): Promise<SyncDueBillingConnectorsResult> {
    const start = Date.now();
    const results: RunInProcessSyncResult[] = [];
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    const connectors = await prisma.billingConnector.findMany({
        where: {
            sync_enabled: true,
            status: "Active",
        },
        orderBy: [{ sync_mode: "asc" }, { modified_at: "asc" }],
        take: MAX_CONNECTORS_PER_RUN,
    });

    const now = new Date();

    for (const connector of connectors) {
        if (connector.sync_mode === "INCREMENTAL") {
            const lastSuccess = await prisma.connectorSyncState.findFirst({
                where: {
                    connector_id: connector.id,
                    last_successful_run_at: { not: null },
                },
                orderBy: { last_successful_run_at: "desc" },
                select: { last_successful_run_at: true },
            });
            const due = isConnectorDue({
                syncMode: "INCREMENTAL",
                syncCronExpression: connector.sync_cron_expression,
                now,
                lastScheduledIncrementalSuccessAt:
                    lastSuccess?.last_successful_run_at ?? null,
                hasScheduledIncrementalSuccess: !!lastSuccess?.last_successful_run_at,
                connectorModifiedAt: connector.modified_at,
            });
            if (!due) {
                skipped += 1;
                continue;
            }
        }

        try {
            const result = await runInProcessSync({
                prisma,
                accountId: connector.account_id,
                trigger: "scheduled",
            });
            results.push(result);
            processed += 1;
            if (!result.ok) failed += 1;
        } catch {
            failed += 1;
            processed += 1;
        }
    }

    const durationMs = Date.now() - start;
    const message = `Billing connector sync: ${processed} processed, ${skipped} skipped, ${failed} failed`;
    return {
        success: failed === 0,
        message,
        processed,
        skipped,
        failed,
        results,
        durationMs,
    };
}
