import type { ConnectorErrorType } from "../billing/connectorErrorClassification";
import { classifyConnectorError } from "../billing/connectorErrorClassification";
import {
    totalMandatoryFieldSkipsFromEntityStats,
    type EntityImportStatsAccum,
} from "../import/aggregateEntityImportStats";
import type {
    BillingConnectorSyncStatus,
    SyncResultForStatus,
} from "./types";

export type { SyncResultForStatus };

function totalImported(result: SyncResultForStatus): number {
    return (
        result.stats.customersImported +
        result.stats.contactsImported +
        result.stats.invoicesImported +
        result.stats.paymentsImported
    );
}

function resolveMandatoryFieldSkips(result: SyncResultForStatus): number {
    if (result.stats.mandatoryFieldSkips != null) {
        return result.stats.mandatoryFieldSkips;
    }
    const entityStats = result.stats.entityImportStats as
        | Partial<Record<string, EntityImportStatsAccum>>
        | undefined;
    return totalMandatoryFieldSkipsFromEntityStats(entityStats);
}

export function resolveSyncExecutionStatus(
    result: SyncResultForStatus
): BillingConnectorSyncStatus {
    if (result.cancelled) {
        return "TIMEOUT";
    }

    const imported = totalImported(result);
    const importErrors = result.stats.importErrors;
    const mandatorySkips = resolveMandatoryFieldSkips(result);
    const hasValidationIssues = importErrors > 0 || mandatorySkips > 0;

    if (hasValidationIssues) {
        return imported > 0 ? "PARTIAL" : "FAILED";
    }

    if (!result.ok) {
        return imported > 0 ? "PARTIAL" : "FAILED";
    }

    return "SUCCESS";
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
    const mandatorySkips = resolveMandatoryFieldSkips(result);
    if (
        result.stats.importErrors > 0 ||
        mandatorySkips > 0 ||
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
