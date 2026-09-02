"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleActivityEmailSendFailure = handleActivityEmailSendFailure;
const emailErrorClassification_1 = require("./emailErrorClassification");
/**
 * Transient SES failure: keep Scheduled for next cron run, increment retry_count.
 */
async function handleActivityEmailSendFailure(prisma, activityContactId, error, currentRetryCount) {
    const summary = (0, emailErrorClassification_1.getEmailErrorSummary)(error);
    if ((0, emailErrorClassification_1.shouldDeferEmailForRetry)(error, currentRetryCount)) {
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
