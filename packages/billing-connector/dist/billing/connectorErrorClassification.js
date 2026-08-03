"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONNECTOR_RETRY_BACKOFF_MS = void 0;
exports.classifyConnectorError = classifyConnectorError;
exports.sleepMs = sleepMs;
function collectText(error) {
    if (error == null) {
        return "";
    }
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        const err = error;
        return [err.name, err.message, err.statusCode, err.code]
            .filter((part) => part != null)
            .join(" ");
    }
    try {
        return JSON.stringify(error);
    }
    catch {
        return String(error);
    }
}
function classifyConnectorError(error, statusCode) {
    const text = collectText(error);
    const code = statusCode ?? extractStatusCode(error);
    if (code === 401 || code === 403 || /auth/i.test(text)) {
        return {
            error_type: "auth",
            retryable: false,
            advanceWatermark: false,
            incrementCircuitBreaker: true,
            message: text || "Authentication failed",
        };
    }
    if (/token.*expir/i.test(text)) {
        return {
            error_type: "token_expired",
            retryable: true,
            advanceWatermark: false,
            incrementCircuitBreaker: false,
            message: text || "Token expired",
        };
    }
    if (code === 429 || /rate\s*limit|throttl/i.test(text)) {
        return {
            error_type: "rate_limit",
            retryable: true,
            advanceWatermark: false,
            incrementCircuitBreaker: false,
            message: text || "Rate limited",
        };
    }
    if (code === 408 || /timeout|timed\s*out|abort/i.test(text)) {
        return {
            error_type: "timeout",
            retryable: true,
            advanceWatermark: false,
            incrementCircuitBreaker: false,
            message: text || "Request timed out",
        };
    }
    if (code != null && code >= 500) {
        return {
            error_type: "5xx",
            retryable: true,
            advanceWatermark: false,
            incrementCircuitBreaker: false,
            message: text || "Upstream server error",
        };
    }
    if (/mapping|validation|required field/i.test(text)) {
        return {
            error_type: "import_validation",
            retryable: false,
            advanceWatermark: true,
            incrementCircuitBreaker: false,
            message: text || "Import validation error",
        };
    }
    return {
        error_type: "unknown",
        retryable: false,
        advanceWatermark: false,
        incrementCircuitBreaker: false,
        message: text || "Unknown connector error",
    };
}
function extractStatusCode(error) {
    if (error && typeof error === "object" && "statusCode" in error) {
        const code = error.statusCode;
        return typeof code === "number" ? code : undefined;
    }
    return undefined;
}
exports.CONNECTOR_RETRY_BACKOFF_MS = [5000, 15000, 30000];
async function sleepMs(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
