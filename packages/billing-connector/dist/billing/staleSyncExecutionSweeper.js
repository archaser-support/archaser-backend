"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepStaleSyncExecutions = sweepStaleSyncExecutions;
const ConnectorSyncExecutionService_1 = require("@/server/services/ConnectorSyncExecutionService");
const MongoLogService_1 = require("@/server/services/MongoLogService");
const enums_1 = require("@/types/enums");
const mongoLog = new MongoLogService_1.MongoLogService();
async function sweepStaleSyncExecutions(connectorId, accountId, provider, timeoutSeconds) {
    const bufferSeconds = 120;
    const olderThan = new Date(Date.now() - (timeoutSeconds + bufferSeconds) * 1000);
    const stale = await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.findStaleRunning(connectorId, olderThan);
    for (const execution of stale) {
        const completedAt = new Date();
        const durationSeconds = Math.max(1, Math.round((completedAt.getTime() - execution.started_at.getTime()) / 1000));
        await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.updateExecution(execution._id.toString(), {
            status: "TIMEOUT",
            completedAt,
            durationSeconds,
            errorMessage: "Sync execution timed out (stale RUNNING sweeper)",
            errorType: "timeout",
        });
        await mongoLog.logMessage({
            level: enums_1.LogLevel.ERROR,
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
