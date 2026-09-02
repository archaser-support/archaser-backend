export type ConnectorErrorType = "auth" | "token_expired" | "mapping_config" | "rate_limit" | "timeout" | "5xx" | "import_validation" | "unknown";
export interface ClassifiedConnectorError {
    error_type: ConnectorErrorType;
    retryable: boolean;
    advanceWatermark: boolean;
    incrementCircuitBreaker: boolean;
    message: string;
}
export declare function classifyConnectorError(error: unknown, statusCode?: number): ClassifiedConnectorError;
export declare const CONNECTOR_RETRY_BACKOFF_MS: readonly [5000, 15000, 30000];
export declare function sleepMs(ms: number): Promise<void>;
