import { ConnectorSyncExecutionService } from "@/server/services/ConnectorSyncExecutionService";
import { MongoLogService } from "@/server/services/MongoLogService";
import { LogLevel } from "@/types/enums";

const mongoLog = new MongoLogService();

export async function sweepStaleSyncExecutions(
    connectorId: number,
    accountId: number,
    provider: string,
    timeoutSeconds: number
): Promise<number> {
    const bufferSeconds = 120;
    const olderThan = new Date(
        Date.now() - (timeoutSeconds + bufferSeconds) * 1000
    );

    const stale = await ConnectorSyncExecutionService.findStaleRunning(
        connectorId,
        olderThan
    );

    for (const execution of stale) {
        const completedAt = new Date();
        const durationSeconds = Math.max(
            1,
            Math.round(
                (completedAt.getTime() - execution.started_at.getTime()) / 1000
            )
        );

        await ConnectorSyncExecutionService.updateExecution(
            execution._id.toString(),
            {
                status: "TIMEOUT",
                completedAt,
                durationSeconds,
                errorMessage: "Sync execution timed out (stale RUNNING sweeper)",
                errorType: "timeout",
            }
        );

        await mongoLog.logMessage({
            level: LogLevel.ERROR,
            message: "Billing connector sync execution timed out",
            source: "billing_connector.sync",
            account_id: accountId,
            correlation_id: execution.correlation_id,
            details: {
                account_id: accountId,
                connector_id: connectorId,
                provider,
                sync_mode: execution.sync_mode,
                trigger: execution.trigger,
                status: "TIMEOUT",
                error_type: "timeout",
                correlation_id: execution.correlation_id,
                sync_execution_id: execution._id.toString(),
            },
        });
    }

    return stale.length;
}
