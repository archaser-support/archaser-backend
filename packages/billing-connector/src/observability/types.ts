export const BILLING_CONNECTOR_SYNC_SOURCE = "billing_connector.sync" as const;

export type BillingConnectorSyncStatus =
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "PARTIAL"
    | "TIMEOUT";

export interface SyncResultForStatus {
    ok: boolean;
    cancelled?: boolean;
    error?: string;
    stats: {
        customersImported: number;
        contactsImported: number;
        invoicesImported: number;
        paymentsImported: number;
        importErrors: number;
    };
    entity_stats?: Record<
        string,
        { pulled: number; success: number; failed: number; skipped: number }
    >;
}

/** Prometheus-facing counters/histograms (no prom-client dependency in this package). */
export interface BillingConnectorSyncMetricsSink {
    incSyncTotal(labels: {
        provider: string;
        status: string;
        sync_mode: string;
        trigger: string;
    }): void;
    observeDuration(
        labels: { provider: string; sync_mode: string },
        seconds: number
    ): void;
    incErrors(labels: {
        provider: string;
        error_type: string;
        sync_mode: string;
    }): void;
    incRecords(
        labels: { provider: string; entity_type: string; result: string },
        count: number
    ): void;
}

export interface BillingConnectorSyncLogFields {
    source: typeof BILLING_CONNECTOR_SYNC_SOURCE;
    account_id: number;
    connector_id: number | null;
    provider: string;
    sync_mode: string;
    trigger: string;
    status: BillingConnectorSyncStatus | string;
    error_type: string | null;
    correlation_id: string | null;
    sync_execution_id: string | null;
    execution_id: string | null;
    entity_type?: string | null;
    duration_seconds?: number;
    entity_stats?: string;
    message?: string;
}

export interface EmitSyncStartInput {
    accountId: number;
    connectorId: number;
    provider: string;
    syncMode: string;
    trigger: string;
    executionId?: string;
    correlationId?: string;
}

export interface EmitSyncFinishInput {
    accountId: number;
    connectorId: number | null;
    provider: string;
    syncMode: string;
    trigger: string;
    executionId?: string;
    correlationId?: string;
    startedAtMs: number;
    result: SyncResultForStatus;
    /** When set, overrides status derived from result (e.g. host already classified). */
    statusOverride?: BillingConnectorSyncStatus;
    errorTypeOverride?: string | null;
}

export interface BillingConnectorObservabilityOptions {
    metrics?: BillingConnectorSyncMetricsSink;
    /**
     * Emit one-line JSON start/finish/error via onLog (or console.log).
     * Progress lines remain plain text through the host onLog.
     * Default: true.
     */
    structuredLogs?: boolean;
    correlationId?: string;
}
