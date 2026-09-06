import {
    BILLING_CONNECTOR_SYNC_SOURCE,
    type BillingConnectorSyncLogFields,
} from "./types";

/** Single-line JSON for Nest stdout → Promtail → Loki (no multiline). */
export function formatBillingConnectorSyncLogLine(
    fields: BillingConnectorSyncLogFields
): string {
    const payload: Record<string, unknown> = {
        source: fields.source,
        account_id: fields.account_id,
        connector_id: fields.connector_id,
        provider: fields.provider,
        sync_mode: fields.sync_mode,
        trigger: fields.trigger,
        status: fields.status,
        error_type: fields.error_type,
        correlation_id: fields.correlation_id,
        sync_execution_id: fields.sync_execution_id,
        execution_id: fields.execution_id,
    };
    if (fields.entity_type != null) {
        payload.entity_type = fields.entity_type;
    }
    if (fields.duration_seconds != null) {
        payload.duration_seconds = fields.duration_seconds;
    }
    if (fields.entity_stats != null) {
        payload.entity_stats = fields.entity_stats;
    }
    if (fields.message != null) {
        payload.message = fields.message;
    }
    return JSON.stringify(payload);
}

export function buildBaseLogFields(input: {
    accountId: number;
    connectorId: number | null;
    provider: string;
    syncMode: string;
    trigger: string;
    status: string;
    errorType?: string | null;
    executionId?: string | null;
    correlationId?: string | null;
    entityType?: string | null;
    durationSeconds?: number;
    entityStats?: unknown;
    message?: string;
}): BillingConnectorSyncLogFields {
    const executionId = input.executionId ?? null;
    let entityStats: string | undefined;
    if (input.entityStats != null) {
        try {
            entityStats = JSON.stringify(input.entityStats);
        } catch {
            entityStats = String(input.entityStats);
        }
    }
    return {
        source: BILLING_CONNECTOR_SYNC_SOURCE,
        account_id: input.accountId,
        connector_id: input.connectorId,
        provider: input.provider,
        sync_mode: input.syncMode,
        trigger: input.trigger,
        status: input.status,
        error_type: input.errorType ?? null,
        correlation_id: input.correlationId ?? executionId,
        sync_execution_id: executionId,
        execution_id: executionId,
        entity_type: input.entityType,
        duration_seconds: input.durationSeconds,
        entity_stats: entityStats,
        message: input.message,
    };
}
