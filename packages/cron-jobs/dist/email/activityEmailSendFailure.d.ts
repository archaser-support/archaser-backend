import type { PrismaClient } from "@prisma/client";
export type EmailSendFailureResult = {
    action: "deferred";
} | {
    action: "permanent";
};
/**
 * Transient SES failure: keep Scheduled for next cron run, increment retry_count.
 */
export declare function handleActivityEmailSendFailure(prisma: PrismaClient, activityContactId: number, error: unknown, currentRetryCount: number): Promise<EmailSendFailureResult>;
