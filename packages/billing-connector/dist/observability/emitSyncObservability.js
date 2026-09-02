"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDefaultBillingConnectorMetricsSink = setDefaultBillingConnectorMetricsSink;
exports.getDefaultBillingConnectorMetricsSink = getDefaultBillingConnectorMetricsSink;
exports.emitBillingConnectorSyncStart = emitBillingConnectorSyncStart;
exports.emitBillingConnectorSyncFinish = emitBillingConnectorSyncFinish;
exports.createBillingConnectorMetricsSinkFromProm = createBillingConnectorMetricsSinkFromProm;
const statusAndErrorType_1 = require("./statusAndErrorType");
const structuredLog_1 = require("./structuredLog");
let defaultMetricsSink = null;
/** Worker/cron can register a process-wide sink when call sites lack DI. */
function setDefaultBillingConnectorMetricsSink(sink) {
    defaultMetricsSink = sink;
}
function getDefaultBillingConnectorMetricsSink() {
    return defaultMetricsSink;
}
function writeStructuredLine(onLog, line) {
    if (onLog) {
        onLog(line);
        return;
    }
    // Cron/worker paths without Nest onLog still need Loki-ingestible stdout.
    console.log(line);
}
function emitBillingConnectorSyncStart(input, onLog, structuredLogs = true) {
    if (!structuredLogs) {
        return;
    }
    const line = (0, structuredLog_1.formatBillingConnectorSyncLogLine)((0, structuredLog_1.buildBaseLogFields)({
        accountId: input.accountId,
        connectorId: input.connectorId,
        provider: input.provider,
        syncMode: input.syncMode,
        trigger: input.trigger,
        status: "RUNNING",
        errorType: null,
        executionId: input.executionId,
        correlationId: input.correlationId,
        message: "Billing connector sync started",
    }));
    writeStructuredLine(onLog, line);
}
function emitBillingConnectorSyncFinish(input, options) {
    const structuredLogs = options?.structuredLogs !== false;
    const metrics = options?.metrics === undefined
        ? defaultMetricsSink
        : options.metrics;
    const status = input.statusOverride ?? (0, statusAndErrorType_1.resolveSyncExecutionStatus)(input.result);
    const errorTypeRaw = input.errorTypeOverride !== undefined
        ? input.errorTypeOverride
        : (0, statusAndErrorType_1.resolveSyncErrorType)(input.result, status);
    const errorType = errorTypeRaw
        ? (0, statusAndErrorType_1.mapClassifiedErrorTypeForMetrics)(errorTypeRaw)
        : null;
    const durationSeconds = Math.max(0, (Date.now() - input.startedAtMs) / 1000);
    const syncMode = input.syncMode || "INCREMENTAL";
    const provider = input.provider || "UNKNOWN";
    const trigger = input.trigger || "manual";
    // Skip SUCCESS finish dumps — huge entity_stats spam Nest/Loki; metrics still record.
    if (structuredLogs && status !== "SUCCESS") {
        const line = (0, structuredLog_1.formatBillingConnectorSyncLogLine)((0, structuredLog_1.buildBaseLogFields)({
            accountId: input.accountId,
            connectorId: input.connectorId,
            provider,
            syncMode,
            trigger,
            status,
            errorType,
            executionId: input.executionId,
            correlationId: input.correlationId,
            durationSeconds: Math.round(durationSeconds * 1000) / 1000,
            entityStats: input.result.entity_stats,
            message: `Billing connector sync finished: ${status}`,
        }));
        writeStructuredLine(options?.onLog, line);
    }
    if (!metrics) {
        return;
    }
    metrics.incSyncTotal({
        provider,
        status,
        sync_mode: syncMode,
        trigger,
    });
    metrics.observeDuration({ provider, sync_mode: syncMode }, durationSeconds);
    if (errorType && status !== "SUCCESS") {
        metrics.incErrors({
            provider,
            error_type: errorType,
            sync_mode: syncMode,
        });
    }
    const entityStats = input.result.entity_stats ?? {};
    for (const [entityType, counts] of Object.entries(entityStats)) {
        if (!counts || typeof counts !== "object") {
            continue;
        }
        const success = Number(counts.success) || 0;
        const failed = Number(counts.failed) || 0;
        const skipped = Number(counts.skipped) || 0;
        if (success > 0) {
            metrics.incRecords({ provider, entity_type: entityType, result: "success" }, success);
        }
        if (failed > 0) {
            metrics.incRecords({ provider, entity_type: entityType, result: "failed" }, failed);
        }
        if (skipped > 0) {
            metrics.incRecords({ provider, entity_type: entityType, result: "skipped" }, skipped);
        }
    }
}
/**
 * Adapt prom-client Counter/Histogram instances (same label shapes as API metrics).
 */
function createBillingConnectorMetricsSinkFromProm(metrics) {
    return {
        incSyncTotal: (labels) => metrics.syncTotal.inc(labels),
        observeDuration: (labels, seconds) => metrics.syncDuration.observe(labels, seconds),
        incErrors: (labels) => metrics.errorsTotal.inc(labels),
        incRecords: (labels, count) => metrics.recordsProcessed.inc(labels, count),
    };
}
