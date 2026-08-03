"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processNotificationRules = processNotificationRules;
const NotificationRuleDeliveryService_1 = require("./notificationRules/NotificationRuleDeliveryService");
async function processNotificationRules(prisma) {
    const start = Date.now();
    try {
        const service = await NotificationRuleDeliveryService_1.NotificationRuleDeliveryService.createService(prisma);
        const summary = await service.processAllCreditInsuranceAccounts();
        const durationMs = Date.now() - start;
        const message = `Notification rules processed for ${summary.accountsProcessed} account(s): ${summary.delivered} delivered, ${summary.skipped} skipped, ${summary.cleared} cleared`;
        return {
            success: true,
            message,
            summary,
            durationMs,
        };
    }
    catch (error) {
        const durationMs = Date.now() - start;
        const message = error instanceof Error
            ? error.message
            : "processNotificationRules failed";
        throw Object.assign(error instanceof Error ? error : new Error(message), { durationMs });
    }
}
