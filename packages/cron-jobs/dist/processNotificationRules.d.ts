import type { PrismaClient } from "@prisma/client";
export declare function processNotificationRules(prisma: PrismaClient): Promise<{
    success: boolean;
    message: string;
    summary?: {
        accountsProcessed: number;
        delivered: number;
        skipped: number;
        cleared: number;
    };
    durationMs: number;
}>;
