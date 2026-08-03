export type ConnectorErrorType =
    | "auth"
    | "token_expired"
    | "mapping_config"
    | "rate_limit"
    | "timeout"
    | "5xx"
    | "import_validation"
    | "unknown";

export interface ClassifiedConnectorError {
    error_type: ConnectorErrorType;
    retryable: boolean;
    advanceWatermark: boolean;
    incrementCircuitBreaker: boolean;
    message: string;
}

function collectText(error: unknown): string {
    if (error == null) {
        return "";
    }
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        const err = error as Error & { statusCode?: number; code?: string };
        return [err.name, err.message, err.statusCode, err.code]
            .filter((part) => part != null)
            .join(" ");
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

export function classifyConnectorError(
    error: unknown,
    statusCode?: number
): ClassifiedConnectorError {
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

function extractStatusCode(error: unknown): number | undefined {
    if (error && typeof error === "object" && "statusCode" in error) {
        const code = (error as { statusCode?: number }).statusCode;
        return typeof code === "number" ? code : undefined;
    }
    return undefined;
}

export const CONNECTOR_RETRY_BACKOFF_MS = [5000, 15000, 30000] as const;

export async function sleepMs(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
