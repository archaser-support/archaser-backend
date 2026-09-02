import type { PrismaClient, notification_type, priority } from "@prisma/client";
/**
 * Minimal in-app notification service for cron jobs.
 * Creates bell notifications that appear in the user's notification center.
 */
export declare class NotificationService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    createNotification(input: {
        type: notification_type;
        title: string;
        message: string;
        priority: priority;
        userId: string;
        accountId: number;
        actionUrl?: string;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
}
