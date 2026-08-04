import type { PrismaClient } from "@prisma/client";
/**
 * Due report schedules: execute via reports Nest S2S when REPORTS_SERVICE_URL
 * is set; email CSV/Excel attachment to schedule_config.recipients when configured.
 */
export declare function executeScheduledReports(prisma: PrismaClient): Promise<{
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
