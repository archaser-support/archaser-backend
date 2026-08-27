import type { BillingConnectorSyncMetricsSink } from "./types";
import {
    mapClassifiedErrorTypeForMetrics,
    resolveSyncErrorType,
    resolveSyncExecutionStatus,
} from "./statusAndErrorType";
import {
    buildBaseLogFields,
    formatBillingConnectorSyncLogLine,
} from "./structuredLog";
import type { EmitSyncFinishInput, EmitSyncStartInput } from "./types";

let defaultMetricsSink: BillingConnectorSyncMetricsSink | null = null;

/** Worker/cron can register a process-wide sink when call sites lack DI. */
export function setDefaultBillingConnectorMetricsSink(
    sink: BillingConnectorSyncMetricsSink | null
): void {
    defaultMetricsSink = sink;
}

export function getDefaultBillingConnectorMetricsSink(): BillingConnectorSyncMetricsSink | null {
    return defaultMetricsSink;
}

function writeStructuredLine(
    onLog: ((message: string) => void) | undefined,
    line: string
): void {
    if (onLog) {
        onLog(line);
        return;
    }
    // Cron/worker paths without Nest onLog still need Loki-ingestible stdout.
    console.log(line);
}

export function emitBillingConnectorSyncStart(
    input: EmitSyncStartInput,
    onLog?: (message: string) => void,
    structuredLogs = true
): void {
    if (!structuredLogs) {
        return;
    }
    const line = formatBillingConnectorSyncLogLine(
        buildBaseLogFields({
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
        })
    );
    writeStructuredLine(onLog, line);
}

export function emitBillingConnectorSyncFinish(
    input: EmitSyncFinishInput,
    options?: {
        onLog?: (message: string) => void;
        metrics?: BillingConnectorSyncMetricsSink | null;
        structuredLogs?: boolean;
    }
): void {
    const structuredLogs = options?.structuredLogs !== false;
    const metrics =
        options?.metrics === undefined
            ? defaultMetricsSink
            : options.metrics;
    const status =
        input.statusOverride ?? resolveSyncExecutionStatus(input.result);
    const errorTypeRaw =
        input.errorTypeOverride !== undefined
            ? input.errorTypeOverride
            : resolveSyncErrorType(input.result, status);
    const errorType = errorTypeRaw
        ? mapClassifiedErrorTypeForMetrics(errorTypeRaw)
        : null;
    const durationSeconds = Math.max(
        0,
        (Date.now() - input.startedAtMs) / 1000
    );
    const syncMode = input.syncMode || "INCREMENTAL";
    const provider = input.provider || "UNKNOWN";
    const trigger = input.trigger || "manual";

    if (structuredLogs) {
        const line = formatBillingConnectorSyncLogLine(
            buildBaseLogFields({
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
                message:
                    status === "SUCCESS"
                        ? "Billing connector sync finished"
                        : `Billing connector sync finished: ${status}`,
            })
        );
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
    metrics.observeDuration(
        { provider, sync_mode: syncMode },
        durationSeconds
    );

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
            metrics.incRecords(
                { provider, entity_type: entityType, result: "success" },
                success
            );
        }
        if (failed > 0) {
            metrics.incRecords(
                { provider, entity_type: entityType, result: "failed" },
                failed
            );
        }
        if (skipped > 0) {
            metrics.incRecords(
                { provider, entity_type: entityType, result: "skipped" },
                skipped
            );
        }
    }
}

/**
 * Adapt prom-client Counter/Histogram instances (same label shapes as API metrics).
 */
export function createBillingConnectorMetricsSinkFromProm(metrics: {
    syncTotal: {
        inc: (labels: {
            provider: string;
            status: string;
            sync_mode: string;
            trigger: string;
        }) => void;
    };
    syncDuration: {
        observe: (
            labels: { provider: string; sync_mode: string },
            value: number
        ) => void;
    };
    errorsTotal: {
        inc: (labels: {
            provider: string;
            error_type: string;
            sync_mode: string;
        }) => void;
    };
    recordsProcessed: {
        inc: (
            labels: { provider: string; entity_type: string; result: string },
            value?: number
        ) => void;
    };
}): BillingConnectorSyncMetricsSink {
    return {
        incSyncTotal: (labels) => metrics.syncTotal.inc(labels),
        observeDuration: (labels, seconds) =>
            metrics.syncDuration.observe(labels, seconds),
        incErrors: (labels) => metrics.errorsTotal.inc(labels),
        incRecords: (labels, count) =>
            metrics.recordsProcessed.inc(labels, count),
    };
}
