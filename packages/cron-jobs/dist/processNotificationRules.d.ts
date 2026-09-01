import type { PrismaClient } from "@prisma/client";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
export declare function processNotificationRules(prisma: PrismaClient, freeze?: CronFrozenAccountGuard): Promise<{
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
