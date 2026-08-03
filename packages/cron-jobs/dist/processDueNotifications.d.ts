/**
 * Process Due Notifications
 *
 * Sends notifications for invoices that are due (or due in N days) based on
 * ActivitiesSequence steps with step_type='due' and days_before_due.
 *
 * Run daily, before handleOverdueInvoices, so invoices due today get
 * notifications before potentially becoming overdue.
 *
 * STAGE 2 PORT: Best-effort port from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * - Core logic: finds due activities, creates SCHEDULED activities with contacts
 * - SMS send: calls @archaser/sms-send when credentials available, otherwise stubs
 * - Email send: stubbed (logs intent, returns true like CreditNotificationEmailService)
 * - Missing: ActivityService.processTemplateContent (template variable replacement)
 * - Missing: Full email/SMS dispatch (will be sent by Activity Workflow Manager when implemented)
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
