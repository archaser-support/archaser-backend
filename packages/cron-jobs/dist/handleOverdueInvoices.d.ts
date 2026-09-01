import type { PrismaClient } from "@prisma/client";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
export type HandleOverdueInvoicesScope = number | {
    customerIds: number[];
};
/**
 * Process overdue invoices: mark past-due Due invoices Overdue, recalc amounts,
 * activate inactive customers with debt, open collection periods when needed.
 */
export declare function handleOverdueInvoices(prisma: PrismaClient, scope?: HandleOverdueInvoicesScope, freeze?: CronFrozenAccountGuard): Promise<{
    success: boolean;
    message: string;
    summary: Record<string, unknown>;
    durationMs: number;
}>;
