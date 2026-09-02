"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSyncExecutionStatus = resolveSyncExecutionStatus;
exports.resolveSyncErrorType = resolveSyncErrorType;
exports.mapClassifiedErrorTypeForMetrics = mapClassifiedErrorTypeForMetrics;
const connectorErrorClassification_1 = require("../billing/connectorErrorClassification");
function resolveSyncExecutionStatus(result) {
    if (result.cancelled) {
        return "TIMEOUT";
    }
    if (result.ok) {
        return "SUCCESS";
    }
    const imported = result.stats.customersImported +
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
function resolveSyncErrorType(result, status) {
    if (status === "SUCCESS" || status === "RUNNING") {
        return null;
    }
    if (result.cancelled || status === "TIMEOUT") {
        return result.cancelled ? "cancelled" : "timeout";
    }
    if (result.error === "CONNECTOR_NOT_FOUND") {
        return "unknown";
    }
    if (result.stats.importErrors > 0 ||
        /import error/i.test(result.error ?? "")) {
        return "import_validation";
    }
    if (result.error) {
        return (0, connectorErrorClassification_1.classifyConnectorError)(result.error).error_type;
    }
    return "unknown";
}
function mapClassifiedErrorTypeForMetrics(errorType) {
    if (!errorType) {
        return "unknown";
    }
    if (errorType === "token_expired") {
        return "auth";
    }
    return errorType;
}
