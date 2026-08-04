/**
 * Activity Workflow Manager
 *
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * server/cron-jobs/activityWorkflowManager.ts
 *
 * Phase 1: Send due SCHEDULED activities (SMS + Email via Nest SMTP env)
 * Phase 2: Generate next automated activities with scheduleDateTime parity
 *
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
