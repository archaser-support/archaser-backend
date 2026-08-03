import type { PrismaClient } from "@prisma/client";
/**
 * Due report schedules: execute via reports Nest S2S when REPORTS_SERVICE_URL
 * is set; otherwise mark run timestamps only (email delivery remains deferred).
 */
export declare function executeScheduledReports(prisma: PrismaClient): Promise<{
    success: boolean;
    message: string;
    summary: {
        due: number;
        executed: number;
        failed: number;
        mode: "s2s" | "timestamp_only";
    };
    durationMs: number;
}>;
