import type { PrismaClient } from "@prisma/client";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
/**
 * Due report schedules: execute via reports Nest S2S when REPORTS_SERVICE_URL
 * is set; email CSV/Excel attachment to schedule_config.recipients when configured.
 */
export declare function executeScheduledReports(prisma: PrismaClient, freeze?: CronFrozenAccountGuard): Promise<{
    success: boolean;
    message: string;
    summary: {
        due: number;
        executed: number;
        failed: number;
        emailed: number;
        mode: "s2s" | "timestamp_only";
    };
    durationMs: number;
}>;
