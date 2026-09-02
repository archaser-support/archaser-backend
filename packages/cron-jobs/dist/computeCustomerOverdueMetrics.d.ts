import { type PrismaClient } from "@prisma/client";
import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
/**
 * Daily job:
 * - Customer: sync oldest_invoice_overdue_date + overdue_block for credit-insurance customers.
 * - Approved-limit expiration: reset approved_limit once expiration date is in the past.
 * - Insurance policy status maintenance.
 */
export declare function computeCustomerOverdueMetrics(prisma: PrismaClient, customerIdFilter?: number, freeze?: CronFrozenAccountGuard): Promise<{
    success: boolean;
    message: string;
    summary: {
        customersSynced: number;
        reportingBreachesPromoted: number;
        limitExpirationsProcessed: number;
        policiesDeactivated: number;
        policiesPrematureDeactivated: number;
        policiesActivated: number;
        topUpsDeactivated: number;
        topUpsActivated: number;
        iterations: number;
    };
    durationMs: number;
}>;
