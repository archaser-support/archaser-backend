import { type BillingConnectorSyncLogFields } from "./types";
/** Single-line JSON for Nest stdout → Promtail → Loki (no multiline). */
export declare function formatBillingConnectorSyncLogLine(fields: BillingConnectorSyncLogFields): string;
export declare function buildBaseLogFields(input: {
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
}): BillingConnectorSyncLogFields;
