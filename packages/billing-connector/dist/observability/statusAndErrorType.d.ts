import type { ConnectorErrorType } from "../billing/connectorErrorClassification";
import type { BillingConnectorSyncStatus, SyncResultForStatus } from "./types";
export type { SyncResultForStatus };
export declare function resolveSyncExecutionStatus(result: SyncResultForStatus): BillingConnectorSyncStatus;
/**
 * Map sync finish / thrown errors onto the Prometheus `error_type` taxonomy
 * used by alerts (auth, rate_limit, 5xx, import_validation, …).
 */
export declare function resolveSyncErrorType(result: SyncResultForStatus, status: BillingConnectorSyncStatus): string | null;
export declare function mapClassifiedErrorTypeForMetrics(errorType: ConnectorErrorType | string | null | undefined): string;
