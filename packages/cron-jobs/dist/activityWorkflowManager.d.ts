/**
 * Activity Workflow Manager
 *
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/activityWorkflowManager.ts
 *
 * BEST-EFFORT PORT: Core Prisma work + SMS send via @archaser/sms-send
 *
 * Phase 1: Send due SCHEDULED activities (SMS + Email stub)
 * - Query SCHEDULED activities due now (status=SCHEDULED, schedule_time <= now)
 * - Load pending ActivityContact rows for each activity
 * - SMS: resolve SMSVendor, call sendViaVendor with DB credentials
 * - Email: stub (mark as deferred/skipped, same pattern as notificationRules)
 * - Update ActivityContact + Activity status (SENT/DELIVERED/FAILED)
 * - Batch with concurrency limit 5
 *
 * Phase 2: Generate next automated activities
 * - Find open collection periods needing next activity (create_next_activity=true)
 * - Create SCHEDULED Activity + ActivityContact for next sequence step
 * - Update collection period (last_automated_step, create_next_activity=false)
 *
 * INTENTIONAL GAPS (documented as code comments):
 * - Full ActivityService.createAutomatedActivity (complex DI dependencies)
 * - ActivityService.processTemplateContent (template variable replacement)
 * - Email send (SMTP client unavailable; stub logs intent)
 * - CommunicationIntelligence / ControlCenterRealtime / LogService
 * - CustomerService.calculateNextAutomatedActivityTime (complex date calc)
 * - Intelligent channel selection / full CI logic
 */
import type { PrismaClient } from "@prisma/client";
export declare function activityWorkflowManager(prisma: PrismaClient, options?: {
    skipSmsSend?: boolean;
    customerId?: number;
}): Promise<{
    success: boolean;
    message: string;
    summary: unknown;
    durationMs: number;
}>;
