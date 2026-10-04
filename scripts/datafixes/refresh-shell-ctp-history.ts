/**
 * Backfill CTP history for shell credit pools that only have today's snapshot
 * (skipped during bulk shell create).
 *
 * Usage:
 *   npx tsx scripts/datafixes/refresh-shell-ctp-history.ts
 *   npx tsx scripts/datafixes/refresh-shell-ctp-history.ts --shell 1012,1013
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    getCreditPoolParentHistoryJobStatus,
    resolveCreditPoolMemberIds,
    startCreditPoolParentHistoryJob,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";

const LOG = "[refresh-shell-ctp-history]";
const ACCOUNT_ID = 10149;
const PARENT_HISTORY_JOB_KIND = "credit_pool_parent_history";
const DEFAULT_SHELL_NUMBERS = ["1012", "1013"];

function parseShellFilter(argv: string[]): string[] | null {
    const idx = argv.indexOf("--shell");
    if (idx === -1) {
        return null;
    }
    const raw = argv[idx + 1];
    if (!raw) {
        throw new Error("--shell requires comma-separated customer_numbers");
    }
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function releaseBlockingJob(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'complete',
            last_error = ${"Cleared before shell CTP history backfill"},
            updated_at = ${new Date()}
        WHERE account_id = ${ACCOUNT_ID}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status IN ('running', 'paused', 'syncing')
    `;
}

async function earliestArDate(
    prisma: PrismaClient,
    customerIds: number[]
): Promise<Date | null> {
    if (customerIds.length === 0) {
        return null;
    }
    const invoices = await prisma.invoice.findFirst({
        where: { customer_id: { in: customerIds } },
        orderBy: { invoice_date: "asc" },
        select: { invoice_date: true },
    });
    const payments = await prisma.invoicePayment.findFirst({
        where: { customer_id: { in: customerIds } },
        orderBy: { payment_date: "asc" },
        select: { payment_date: true },
    });
    const dates = [invoices?.invoice_date, payments?.payment_date].filter(
        (d): d is Date => d != null
    );
    if (dates.length === 0) {
        return null;
    }
    dates.sort((a, b) => a.getTime() - b.getTime());
    return dates[0]!;
}

async function waitForHistoryJob(prisma: PrismaClient): Promise<{
    status: string;
    daysDone: number;
    daysTotal: number;
    lastError: string | null;
}> {
    for (;;) {
        const status = await getCreditPoolParentHistoryJobStatus(ACCOUNT_ID, {
            dbClient: prisma,
        });
        const done =
            status.status === "complete" ||
            status.status === "failed" ||
            status.status === "paused";
        console.log(LOG, "job progress", {
            status: status.status,
            daysDone: status.daysDone,
            daysTotal: status.daysTotal,
            lastError: status.lastError,
        });
        if (done) {
            return {
                status: status.status,
                daysDone: status.daysDone,
                daysTotal: status.daysTotal,
                lastError: status.lastError,
            };
        }
        await new Promise((r) => setTimeout(r, 10_000));
    }
}

async function main(): Promise<void> {
    const filter = parseShellFilter(process.argv.slice(2));
    const shellNumbers = filter ?? DEFAULT_SHELL_NUMBERS;
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    console.log(LOG, { accountId: ACCOUNT_ID, shellNumbers });

    try {
        await releaseBlockingJob(prisma);

        const shells = await prisma.customer.findMany({
            where: {
                account_id: ACCOUNT_ID,
                customer_number: { in: shellNumbers },
            },
            select: { id: true, customer_number: true },
            orderBy: { customer_number: "asc" },
        });

        if (shells.length === 0) {
            throw new Error(
                `No shells found for numbers: ${shellNumbers.join(",")}`
            );
        }

        for (const shell of shells) {
            const { memberIds } = await resolveCreditPoolMemberIds(
                shell.id,
                ACCOUNT_ID,
                prisma
            );
            const fromDate =
                (await earliestArDate(prisma, memberIds)) ?? startOfTodayUtc();
            const toDate = startOfTodayUtc();
            const beforeCount = await prisma.customerPolicyTrend.count({
                where: { customer_id: shell.id },
            });

            console.log(LOG, "starting pool history", {
                shellCustomerNumber: shell.customer_number,
                shellCustomerId: shell.id,
                memberCount: memberIds.length,
                fromDate: fromDate.toISOString().slice(0, 10),
                toDate: toDate.toISOString().slice(0, 10),
                trendRowsBefore: beforeCount,
            });

            await releaseBlockingJob(prisma);
            await startCreditPoolParentHistoryJob({
                accountId: ACCOUNT_ID,
                customerIds: memberIds,
                fromDate,
                toDate,
                dbClient: prisma,
            });

            const result = await waitForHistoryJob(prisma);
            const afterCount = await prisma.customerPolicyTrend.count({
                where: { customer_id: shell.id },
            });
            console.log(LOG, "pool history finished", {
                shellCustomerNumber: shell.customer_number,
                shellCustomerId: shell.id,
                result,
                trendRowsAfter: afterCount,
            });

            if (result.status === "failed") {
                throw new Error(
                    `History failed for shell ${shell.customer_number}: ${result.lastError}`
                );
            }
        }

        console.log(LOG, "done", { shells: shells.length });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, "failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
