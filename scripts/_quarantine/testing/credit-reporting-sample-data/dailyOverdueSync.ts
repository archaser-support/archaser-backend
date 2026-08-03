import { prisma } from "@/lib/prisma";
import { CustomerService } from "@/server/services/CustomerService";
import { stampInvoiceInsuranceFieldsAsOf } from "@/server/services/creditInsurance/stampInvoiceInsuranceFieldsAsOf";
import { syncCustomerInsuranceFields } from "@/server/services/creditInsurance/syncCustomerInsuranceFields";

import type { HistoryWindow } from "./types";
import { addUtcDaysTo, formatUtcDate } from "./window";

function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(
            date.getUTCFullYear(),
            date.getUTCMonth(),
            date.getUTCDate()
        )
    );
}

/**
 * Flip open Due invoices past their due date to Overdue as of the simulation day.
 */
export async function flipPastDueInvoicesForAccount(
    accountId: number,
    asOfDay: Date
): Promise<number[]> {
    const asOfStart = startOfUtcDay(asOfDay);

    const candidates = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            status: "Due",
            due_date: { lt: asOfStart },
            outstanding_debt: { gt: 0 },
        },
        select: {
            id: true,
            customer_id: true,
        },
    });

    if (candidates.length === 0) {
        return [];
    }

    await prisma.invoice.updateMany({
        where: {
            id: { in: candidates.map((row) => row.id) },
        },
        data: {
            status: "Overdue",
        },
    });

    return [
        ...new Set(
            candidates
                .map((row) => row.customer_id)
                .filter((id): id is number => id != null)
        ),
    ];
}

export async function syncAccountCustomerInsuranceAsOf(
    accountId: number,
    asOfDay: Date,
    customerIds?: number[]
): Promise<number> {
    const ids =
        customerIds ??
        (
            await prisma.customer.findMany({
                where: { account_id: accountId },
                select: { id: true },
                orderBy: { id: "asc" },
            })
        ).map((row) => row.id);

    for (const customerId of ids) {
        await syncCustomerInsuranceFields(customerId, {
            runFollowUpEffects: false,
            asOfDate: asOfDay,
        });
    }

    return ids.length;
}

async function restampInsuranceFieldsForAccountDay(
    accountId: number,
    day: Date
): Promise<number> {
    const dayStart = startOfUtcDay(day);
    const dayEnd = addUtcDaysTo(dayStart, 1);
    let restamped = 0;

    const invoices = await prisma.invoice.findMany({
        where: {
            account_id: accountId,
            invoice_date: {
                gte: dayStart,
                lt: dayEnd,
            },
        },
        select: { id: true },
        orderBy: { id: "asc" },
    });

    for (const invoice of invoices) {
        await stampInvoiceInsuranceFieldsAsOf(invoice.id, day);
        restamped += 1;
    }

    const payments = await prisma.invoicePayment.findMany({
        where: {
            account_id: accountId,
            payment_date: {
                gte: dayStart,
                lt: dayEnd,
            },
        },
        select: { invoice_id: true },
        distinct: ["invoice_id"],
    });

    for (const payment of payments) {
        if (payment.invoice_id == null) {
            continue;
        }
        await stampInvoiceInsuranceFieldsAsOf(payment.invoice_id, day);
        restamped += 1;
    }

    return restamped;
}

export type DailyOverdueSyncResult = {
    flippedCustomerIds: number[];
    customersSynced: number;
};

/**
 * Run production-equivalent overdue status + customer insurance sync for one simulation day.
 */
export async function runDailyOverdueSyncForAccount(args: {
    accountId: number;
    asOfDay: Date;
    recalculateAmounts?: boolean;
}): Promise<DailyOverdueSyncResult> {
    const flippedCustomerIds = await flipPastDueInvoicesForAccount(
        args.accountId,
        args.asOfDay
    );

    const customersSynced = await syncAccountCustomerInsuranceAsOf(
        args.accountId,
        args.asOfDay
    );

    if (args.recalculateAmounts !== false && flippedCustomerIds.length > 0) {
        await CustomerService.recalculateAllAmountsForCustomers(
            flippedCustomerIds
        );
    }

    return {
        flippedCustomerIds,
        customersSynced,
    };
}

export type ChronologicalOverdueReplayResult = {
    daysProcessed: number;
    totalFlippedCustomers: number;
    totalInsuranceSyncs: number;
    totalRestamps: number;
};

/**
 * Replay Due→Overdue transitions, overdue_block, and insurance stamps day-by-day so
 * historical sample data matches production cron behavior at window end.
 */
export async function replayChronologicalOverdueState(args: {
    accountId: number;
    window: HistoryWindow;
}): Promise<ChronologicalOverdueReplayResult> {
    let totalFlippedCustomers = 0;
    let totalInsuranceSyncs = 0;
    let totalRestamps = 0;

    for (let dayOffset = 0; dayOffset < args.window.windowDays; dayOffset++) {
        const day = addUtcDaysTo(args.window.windowStart, dayOffset);
        const syncResult = await runDailyOverdueSyncForAccount({
            accountId: args.accountId,
            asOfDay: day,
            recalculateAmounts: false,
        });
        totalFlippedCustomers += syncResult.flippedCustomerIds.length;
        totalInsuranceSyncs += syncResult.customersSynced;
        totalRestamps += await restampInsuranceFieldsForAccountDay(
            args.accountId,
            day
        );
    }

    const customers = await prisma.customer.findMany({
        where: { account_id: args.accountId },
        select: { id: true },
    });
    await CustomerService.recalculateAllAmountsForCustomers(
        customers.map((row) => row.id)
    );

    console.log(
        `  chronological overdue replay: ${args.window.windowDays} days through ${formatUtcDate(args.window.windowEnd)} | restamps=${totalRestamps}`
    );

    return {
        daysProcessed: args.window.windowDays,
        totalFlippedCustomers,
        totalInsuranceSyncs,
        totalRestamps,
    };
}
