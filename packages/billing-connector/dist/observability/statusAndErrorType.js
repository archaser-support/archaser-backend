"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSyncExecutionStatus = resolveSyncExecutionStatus;
exports.resolveSyncErrorType = resolveSyncErrorType;
exports.mapClassifiedErrorTypeForMetrics = mapClassifiedErrorTypeForMetrics;
const connectorErrorClassification_1 = require("../billing/connectorErrorClassification");
const aggregateEntityImportStats_1 = require("../import/aggregateEntityImportStats");
function totalImported(result) {
    return (result.stats.customersImported +
        result.stats.contactsImported +
        result.stats.invoicesImported +
        result.stats.paymentsImported);
}
function resolveMandatoryFieldSkips(result) {
    if (result.stats.mandatoryFieldSkips != null) {
        return result.stats.mandatoryFieldSkips;
    }
    const entityStats = result.stats.entityImportStats;
    return (0, aggregateEntityImportStats_1.totalMandatoryFieldSkipsFromEntityStats)(entityStats);
}
function resolveSyncExecutionStatus(result) {
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
    const mandatorySkips = resolveMandatoryFieldSkips(result);
    if (result.stats.importErrors > 0 ||
        mandatorySkips > 0 ||
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
