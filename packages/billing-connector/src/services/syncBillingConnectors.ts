import { prisma } from "@/lib/prisma";
import {
    BillingConnectorSyncService,
    type ConnectorSyncRunResult,
} from "@/server/services/BillingConnectorSyncService";
import { ConnectorSyncExecutionService } from "@/server/services/ConnectorSyncExecutionService";
import { isConnectorDue } from "@/server/services/billingConnectorSchedule";
import { sweepStaleSyncExecutions } from "@/server/integrations/billing/staleSyncExecutionSweeper";

const MAX_CONNECTORS_PER_RUN = Number.parseInt(
    process.env.BILLING_CONNECTOR_MAX_CONNECTORS_PER_RUN ?? "5",
    10
);

export default async function syncBillingConnectorsJob(
    _customerId?: number,
    logCallback?: (
        message: string,
        level: "INFO" | "ERROR" | "WARNING" | "DEBUG",
        parameters?: Record<string, unknown>
    ) => void,
    stepCollector?: {
        addStep: (
            step: string,
            message: string,
            level?: "INFO" | "ERROR" | "WARNING" | "DEBUG",
            parameters?: Record<string, unknown>,
            results?: Record<string, unknown>,
            duration?: number
        ) => void;
    }
): Promise<{
    success: boolean;
    message: string;
    summary?: Record<string, unknown>;
    duration: number;
}> {
    const start = Date.now();
    const results: ConnectorSyncRunResult[] = [];
    let processed = 0;
    let failed = 0;
    let skipped = 0;

    try {
        const connectors = await prisma.billingConnector.findMany({
            where: {
                sync_enabled: true,
                status: "Active",
            },
            orderBy: [{ sync_mode: "asc" }, { modified_at: "asc" }],
            take: MAX_CONNECTORS_PER_RUN,
        });

        stepCollector?.addStep(
            "CONNECTOR_SYNC_START",
            `Processing ${connectors.length} billing connector(s)`,
            "INFO",
            { connector_count: connectors.length }
        );

        const now = new Date();

        for (const connector of connectors) {
            await sweepStaleSyncExecutions(
                connector.id,
                connector.account_id,
                connector.provider,
                connector.backfill_max_duration_seconds
            );

            const mode =
                connector.sync_mode === "INCREMENTAL" ? "incremental" : "backfill";

            if (connector.sync_mode === "INCREMENTAL") {
                const [
                    lastScheduledIncrementalSuccessAt,
                    hasScheduledIncrementalSuccess,
                ] = await Promise.all([
                    ConnectorSyncExecutionService.getLastScheduledIncrementalSuccessAt(
                        connector.id
                    ),
                    ConnectorSyncExecutionService.hasScheduledIncrementalSuccess(
                        connector.id
                    ),
                ]);

                const due = isConnectorDue({
                    syncMode: "INCREMENTAL",
                    syncCronExpression: connector.sync_cron_expression,
                    now,
                    lastScheduledIncrementalSuccessAt,
                    hasScheduledIncrementalSuccess,
                    connectorModifiedAt: connector.modified_at,
                });

                if (!due) {
                    skipped += 1;
                    stepCollector?.addStep(
                        "CONNECTOR_SYNC_SKIPPED",
                        `Skipped connector ${connector.id} (not due)`,
                        "DEBUG",
                        {
                            account_id: connector.account_id,
                            connector_id: connector.id,
                        }
                    );
                    continue;
                }
            }

            try {
                const result =
                    await BillingConnectorSyncService.getInstance().runSync({
                        accountId: connector.account_id,
                        mode,
                        trigger: "scheduled",
                        skipAntiSpam: true,
                    });
                results.push(result);
                processed += 1;
                if (result.status === "FAILED") {
                    failed += 1;
                }
            } catch (error) {
                failed += 1;
                const message =
                    error instanceof Error ? error.message : String(error);
                logCallback?.(
                    `Connector sync failed for account ${connector.account_id}: ${message}`,
                    "ERROR",
                    { account_id: connector.account_id, connector_id: connector.id }
                );
            }
        }

        const duration = Date.now() - start;
        const message = `Billing connector sync: ${processed} processed, ${skipped} skipped, ${failed} failed`;
        stepCollector?.addStep("CONNECTOR_SYNC_DONE", message, "INFO", {
            processed,
            skipped,
            failed,
        });
        logCallback?.(message, failed > 0 ? "WARNING" : "INFO", {
            processed,
            skipped,
            failed,
            results,
        });

        return {
            success: failed === 0,
            message,
            summary: { processed, skipped, failed, results },
            duration,
        };
    } catch (error) {
        const duration = Date.now() - start;
        const message =
            error instanceof Error ? error.message : "Billing connector cron failed";
        stepCollector?.addStep("CONNECTOR_SYNC_ERROR", message, "ERROR");
        logCallback?.(message, "ERROR");
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(message);
    }
}
