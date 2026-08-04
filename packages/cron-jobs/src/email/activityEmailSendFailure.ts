import type { PrismaClient } from "@prisma/client";

import {
    getEmailErrorSummary,
    shouldDeferEmailForRetry,
} from "./emailErrorClassification";

export type EmailSendFailureResult =
    | { action: "deferred" }
    | { action: "permanent" };

/**
 * Transient SES failure: keep Scheduled for next cron run, increment retry_count.
 */
export async function handleActivityEmailSendFailure(
    prisma: PrismaClient,
    activityContactId: number,
    error: unknown,
    currentRetryCount: number
): Promise<EmailSendFailureResult> {
    const summary = getEmailErrorSummary(error);

    if (shouldDeferEmailForRetry(error, currentRetryCount)) {
        await prisma.activityContact.update({
            where: { id: activityContactId },
            data: {
                status: "Scheduled",
                retry_count: currentRetryCount + 1,
                failure_reason: summary,
                failed_at: new Date(),
                modified_at: new Date(),
            },
        });
        return { action: "deferred" };
    }

    await prisma.activityContact.update({
        where: { id: activityContactId },
        data: {
            status: "Failed",
            failed_at: new Date(),
            failure_reason: summary,
            modified_at: new Date(),
        },
    });
    return { action: "permanent" };
}
