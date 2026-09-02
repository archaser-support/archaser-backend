"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const crypto_1 = require("crypto");
/**
 * Minimal in-app notification service for cron jobs.
 * Creates bell notifications that appear in the user's notification center.
 */
class NotificationService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createNotification(input) {
        await this.prisma.notification.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                type: input.type,
                title: input.title,
                message: input.message,
                priority: input.priority,
                user_id: input.userId,
                account_id: input.accountId,
                action_url: input.actionUrl,
                metadata: input.metadata,
                read: false,
                // created_by and modified_by can be null (system-generated)
            },
        });
    }
}
exports.NotificationService = NotificationService;
