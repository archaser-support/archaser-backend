import type { PrismaClient } from "@prisma/client";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
/**
 * Safety net: for collection periods closed since last_run_at, mark zero-debt
 * Overdue invoices as Paid and refresh customer rollups / insurance fields.
 */
export declare function fixClosedCollectionData(prisma: PrismaClient, lastRunAt: Date, freeze?: CronFrozenAccountGuard): Promise<{
    success: boolean;
    message: string;
    summary: {
        totalCollectionPeriods: number;
        invoicesUpdated: number;
        customersRecalculated: number;
    };
    durationMs: number;
}>;
