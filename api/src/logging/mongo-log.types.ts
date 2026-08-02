export enum LogLevel {
    DEBUG = "DEBUG",
    INFO = "INFO",
    WARNING = "WARNING",
    ERROR = "ERROR",
    CRITICAL = "CRITICAL",
}

export interface CreateLogData {
    timestamp?: Date;
    level: LogLevel;
    message: string;
    source: string;
    details?: unknown;
    account_id?: number;
    user_id?: number;
    job_id?: number;
    correlation_id?: string;
    sub_source?: string;
}

export const LOG_COLLECTION_NAME = "logs";
export const DEFAULT_TTL_SECONDS = 5 * 24 * 60 * 60;
