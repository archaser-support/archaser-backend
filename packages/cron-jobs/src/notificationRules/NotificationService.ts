import type { PrismaClient, notification_type, priority } from "@prisma/client";
import { randomUUID } from "crypto";

/**
 * Minimal in-app notification service for cron jobs.
 * Creates bell notifications that appear in the user's notification center.
 */
export class NotificationService {
    constructor(private readonly prisma: PrismaClient) {}

    async createNotification(input: {
        type: notification_type;
        title: string;
        message: string;
        priority: priority;
        userId: string;
        accountId: number;
        actionUrl?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        await this.prisma.notification.create({
            data: {
                id: randomUUID(),
                type: input.type,
                title: input.title,
                message: input.message,
                priority: input.priority,
                user_id: input.userId,
                account_id: input.accountId,
                action_url: input.actionUrl,
                metadata: input.metadata as any,
                read: false,
                // created_by and modified_by can be null (system-generated)
            },
        });
    }
}
