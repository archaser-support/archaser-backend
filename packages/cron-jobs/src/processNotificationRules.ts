import type { PrismaClient } from "@prisma/client";
import { NotificationRuleDeliveryService } from "./notificationRules/NotificationRuleDeliveryService";

export async function processNotificationRules(
    prisma: PrismaClient
): Promise<{
    success: boolean;
    message: string;
    summary?: {
        accountsProcessed: number;
        delivered: number;
        skipped: number;
        cleared: number;
    };
    durationMs: number;
}> {
    const start = Date.now();
    try {
        const service =
            await NotificationRuleDeliveryService.createService(prisma);
        const summary = await service.processAllCreditInsuranceAccounts();
        const durationMs = Date.now() - start;
        const message = `Notification rules processed for ${summary.accountsProcessed} account(s): ${summary.delivered} delivered, ${summary.skipped} skipped, ${summary.cleared} cleared`;

        return {
            success: true,
            message,
            summary,
            durationMs,
        };
    } catch (error: unknown) {
        const durationMs = Date.now() - start;
        const message =
            error instanceof Error
                ? error.message
                : "processNotificationRules failed";
        throw Object.assign(
            error instanceof Error ? error : new Error(message),
            { durationMs }
        );
    }
}
