import type { PrismaClient } from "@prisma/client";
import { fetchTwilioMessageStatus } from "@archaser/sms-send";
import type { CronJobResult } from "./handlers";
import { jobLog } from "./logging/jobLog";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
import { applyActivityContactDelivery } from "./delivery/applyActivityContactDelivery";

function mapTwilioStatus(
    status: string
): "delivered" | "failed" | null {
    const normalized = status.toLowerCase();
    if (normalized === "delivered") {
        return "delivered";
    }
    if (
        normalized === "failed" ||
        normalized === "undelivered" ||
        normalized === "canceled"
    ) {
        return "failed";
    }
    return null;
}

/**
 * Poll Twilio for Sent SMS whose delivery webhook never reached us.
 * Runs from the existing "Inforu SMS Status Check" cron.
 */
export async function checkTwilioSmsStatus(
    prisma: PrismaClient,
    freeze?: CronFrozenAccountGuard
): Promise<CronJobResult> {
    const start = Date.now();
    const summary = {
        pendingMessagesFound: 0,
        messagesProcessed: 0,
        statusUpdates: 0,
        errors: 0,
    };

    try {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const pendingMessages = await prisma.activityContact.findMany({
            where: {
                status: { in: ["Sent", "Scheduled"] },
                communication_channel: "SMS",
                SMSVendor: { provider: "twilio" },
                OR: [
                    { vendor_message_id: { not: null } },
                    { message_id: { not: null } },
                ],
                created_at: { gte: sevenDaysAgo },
                ...(freeze && freeze.frozenAccountIds.size > 0
                    ? {
                          Activity: {
                              account_id: {
                                  notIn: [...freeze.frozenAccountIds],
                              },
                          },
                      }
                    : {}),
            },
            include: {
                SMSVendor: true,
            },
            take: 20,
        });

        summary.pendingMessagesFound = pendingMessages.length;

        if (pendingMessages.length === 0) {
            return {
                success: true,
                message: "No pending Twilio SMS messages to check",
                summary,
                durationMs: Date.now() - start,
            };
        }

        const batchSize = 5;
        for (let i = 0; i < pendingMessages.length; i += batchSize) {
            const batch = pendingMessages.slice(i, i + batchSize);
            await Promise.all(
                batch.map(async (message) => {
                    try {
                        const updated = await checkTwilioMessageStatus(
                            prisma,
                            message
                        );
                        summary.messagesProcessed++;
                        if (updated) summary.statusUpdates++;
                    } catch (error) {
                        summary.errors++;
                        jobLog(
                            "TwilioSmsStatusCheck",
                            "error",
                            `Failed to process message ${message.id}`,
                            {
                                error:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            }
                        );
                    }
                })
            );
            if (i + batchSize < pendingMessages.length) {
                await new Promise((resolve) => setTimeout(resolve, 200));
            }
        }

        return {
            success: true,
            message: `Processed ${summary.messagesProcessed} Twilio messages, ${summary.statusUpdates} status updates, ${summary.errors} errors`,
            summary,
            durationMs: Date.now() - start,
        };
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Twilio SMS status check failed";
        return {
            success: false,
            message,
            summary,
            durationMs: Date.now() - start,
        };
    }
}

async function checkTwilioMessageStatus(
    prisma: PrismaClient,
    message: {
        id: number;
        message_id: string | null;
        vendor_message_id: string | null;
        SMSVendor: {
            account_sid: string | null;
            auth_token: string | null;
        } | null;
    }
): Promise<boolean> {
    if (!message.SMSVendor) {
        return false;
    }
    const messageIdToCheck =
        message.vendor_message_id || message.message_id;
    if (!messageIdToCheck) {
        return false;
    }

    const remote = await fetchTwilioMessageStatus(
        message.SMSVendor,
        messageIdToCheck
    );
    if (!remote) {
        return false;
    }

    const outcome = mapTwilioStatus(remote.status);
    if (!outcome) {
        return false;
    }

    await applyActivityContactDelivery(prisma, message.id, outcome, {
        errorMsg:
            outcome === "failed"
                ? remote.errorMessage ||
                  (remote.errorCode != null
                      ? `Twilio error ${remote.errorCode}`
                      : "Twilio delivery failed")
                : null,
    });
    return true;
}
