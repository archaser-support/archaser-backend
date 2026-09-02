import type { ConnectorErrorType } from "../billing/connectorErrorClassification";
import { classifyConnectorError } from "../billing/connectorErrorClassification";
import type {
    BillingConnectorSyncStatus,
    SyncResultForStatus,
} from "./types";

export type { SyncResultForStatus };

export function resolveSyncExecutionStatus(
    result: SyncResultForStatus
): BillingConnectorSyncStatus {
    if (result.cancelled) {
        return "TIMEOUT";
    }
    if (result.ok) {
        return "SUCCESS";
    }
    const imported =
        result.stats.customersImported +
        result.stats.contactsImported +
        result.stats.invoicesImported +
        result.stats.paymentsImported;
    if (imported > 0 && result.stats.importErrors > 0) {
        return "PARTIAL";
    }
    return "FAILED";
}

/**
 * Map sync finish / thrown errors onto the Prometheus `error_type` taxonomy
 * used by alerts (auth, rate_limit, 5xx, import_validation, …).
 */
export function resolveSyncErrorType(
    result: SyncResultForStatus,
    status: BillingConnectorSyncStatus
): string | null {
    if (status === "SUCCESS" || status === "RUNNING") {
        return null;
    }
    if (result.cancelled || status === "TIMEOUT") {
        return result.cancelled ? "cancelled" : "timeout";
    }
    if (result.error === "CONNECTOR_NOT_FOUND") {
        return "unknown";
    }
    if (
        result.stats.importErrors > 0 ||
        /import error/i.test(result.error ?? "")
    ) {
        return "import_validation";
    }
    if (result.error) {
        return classifyConnectorError(result.error).error_type;
    }
    return "unknown";
}

export function mapClassifiedErrorTypeForMetrics(
    errorType: ConnectorErrorType | string | null | undefined
): string {
    if (!errorType) {
        return "unknown";
    }
    if (errorType === "token_expired") {
        return "auth";
    }
    return errorType;
}
