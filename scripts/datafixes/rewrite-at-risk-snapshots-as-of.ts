/**
 * One-time as-of rewrite of CustomerPolicyTrend + CreditDashboardDailySnapshot
 * at-risk / compliant / health using Σ max(capacity gap, terms breach) per open invoice.
 *
 * Reuses the existing CreditAsOfBackfillJob day-walk (payment-ledger open AR for each day D).
 * Do NOT run against production without an explicit ops decision.
 *
 * Usage:
 *   npx tsx scripts/datafixes/rewrite-at-risk-snapshots-as-of.ts --account <id> --dry-run
 *   npx tsx scripts/datafixes/rewrite-at-risk-snapshots-as-of.ts --account <id> --run
 *   npx tsx scripts/datafixes/rewrite-at-risk-snapshots-as-of.ts --account <id> --from YYYY-MM-DD --to YYYY-MM-DD --run
 *
 * Admin UI / API equivalent (full history from earliest invoice → today):
 *   POST /api/credit-insurance/as-of-backfill/:accountId { "action": "start" }
 *   (ARchaser-admin only)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

import {
    bindCreditInsurancePrisma,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";
import {
    countInclusiveUtcDays,
    startCreditAsOfBackfillJob,
} from "../../api/src/credit-insurance/domain/creditAsOfBackfillJob";

function parseYmd(value: string | undefined, flag: string): Date | null {
    if (value == null || value.trim() === "") {
        return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) {
        throw new Error(`${flag} must be YYYY-MM-DD`);
    }
    return new Date(
        Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    );
}

function parseArgs(argv: string[]): {
    accountId: number;
    dryRun: boolean;
    run: boolean;
    fromDate: Date | null;
    toDate: Date | null;
} {
    const accountIndex = argv.indexOf("--account");
    const accountId = Number(accountIndex === -1 ? NaN : argv[accountIndex + 1]);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("--account <id> is required");
    }
    const dryRun = argv.includes("--dry-run");
    const run = argv.includes("--run");
    if (dryRun === run) {
        throw new Error("Pass exactly one of --dry-run or --run");
    }
    const fromIndex = argv.indexOf("--from");
    const toIndex = argv.indexOf("--to");
    return {
        accountId,
        dryRun,
        run,
        fromDate: parseYmd(
            fromIndex === -1 ? undefined : argv[fromIndex + 1],
            "--from"
        ),
        toDate: parseYmd(toIndex === -1 ? undefined : argv[toIndex + 1], "--to"),
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    try {
        const account = await prisma.account.findUnique({
            where: { id: args.accountId },
            select: { id: true, has_credit_insurance: true, name: true },
        });
        if (!account) {
            throw new Error(`account ${args.accountId} not found`);
        }
        if (!account.has_credit_insurance) {
            throw new Error(
                `account ${args.accountId} does not have credit insurance enabled`
            );
        }

        const toDate = args.toDate ?? startOfTodayUtc();
        let fromDate = args.fromDate;
        if (fromDate == null) {
            const agg = await prisma.invoice.aggregate({
                where: {
                    customer_id: { not: null },
                    Customer: { account_id: args.accountId },
                },
                _min: { invoice_date: true },
            });
            if (!agg._min.invoice_date) {
                console.log(
                    JSON.stringify({
                        accountId: args.accountId,
                        message: "No invoices; nothing to rewrite",
                    })
                );
                return;
            }
            fromDate = new Date(
                Date.UTC(
                    agg._min.invoice_date.getUTCFullYear(),
                    agg._min.invoice_date.getUTCMonth(),
                    agg._min.invoice_date.getUTCDate()
                )
            );
        }

        if (toDate.getTime() < fromDate.getTime()) {
            throw new Error("--to must be on or after --from");
        }

        const daysTotal = countInclusiveUtcDays(fromDate, toDate);
        const plan = {
            accountId: args.accountId,
            accountName: account.name,
            fromDate: fromDate.toISOString().slice(0, 10),
            toDate: toDate.toISOString().slice(0, 10),
            daysTotal,
            writers: [
                "syncCustomerPolicyTrendSnapshotForAccount",
                "takeCreditDashboardDailySnapshotsForAccount",
            ],
            formula: "computeCustomerRiskExposure (Σ max(gap, breach))",
        };

        if (args.dryRun) {
            console.log(JSON.stringify({ mode: "dry-run", ...plan }, null, 2));
            return;
        }

        console.log(
            JSON.stringify({ mode: "run", ...plan, status: "starting" }, null, 2)
        );
        const status = await startCreditAsOfBackfillJob(
            args.accountId,
            fromDate,
            toDate,
            {
                requestedBy: "rewrite-at-risk-snapshots-as-of",
                skipReportingBreach: true,
                dbClient: prisma,
                runInline: true,
            }
        );
        console.log(JSON.stringify({ mode: "run", result: status }, null, 2));
        if (status.status === "failed") {
            process.exitCode = 1;
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(
        error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
});
