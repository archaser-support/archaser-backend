/**
 * Process Due Notifications
 *
 * Sends notifications for invoices that are due (or due in N days) based on
 * ActivitiesSequence steps with step_type='due' and days_before_due.
 *
 * Creates SCHEDULED activities; channel send handled by Activity Workflow Manager.
 */
import type { PrismaClient } from "@prisma/client";
export declare function processDueNotifications(prisma: PrismaClient, options?: {
    customerId?: number;
    skipSmsSend?: boolean;
    fastForwardScheduledActivities?: boolean;
}): Promise<{
    success: boolean;
    message: string;
    summary?: {
        processed: number;
        sent: number;
        skipped: number;
        errors: string[];
    };
    durationMs: number;
}>;
