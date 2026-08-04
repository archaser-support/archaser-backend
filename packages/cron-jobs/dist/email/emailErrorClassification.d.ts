/** True when SES/SMTP failure is likely infrastructure-related and may succeed on retry. */
export declare function isTransientEmailError(error: unknown): boolean;
/** Truncate for ActivityContact.failure_reason (VARCHAR 255). */
export declare function getEmailErrorSummary(error: unknown): string;
/** 0 = unlimited workflow-level retries across cron runs. */
export declare function getEmailTransientMaxRetries(): number;
export declare function shouldDeferEmailForRetry(error: unknown, currentRetryCount: number): boolean;
