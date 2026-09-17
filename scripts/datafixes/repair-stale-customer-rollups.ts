/**
 * Ops repair: recalculate customers whose denormalized due/overdue rollups
 * disagree with live Due/Overdue invoice counts (same path as sync finalize).
 *
 * Default scan matches the Sep 17 virtual-close stale cohort pattern:
 * number_of_overdue_invoices > 0 with zero live Overdue invoices.
 *
 * Usage:
 *   npx tsx scripts/datafixes/repair-stale-customer-rollups.ts --dry-run
 *   npx tsx scripts/datafixes/repair-stale-customer-rollups.ts --account 10149 --fix
 *   npx tsx scripts/datafixes/repair-stale-customer-rollups.ts --customer 21137 --fix
 *   npx tsx scripts/datafixes/repair-stale-customer-rollups.ts --all-mismatches --account 10149 --fix
 *
 * Does not log secrets or connection strings.
 */
import "dotenv/config";
import * as path from "path";
import { PrismaClient } from "@prisma/client";

import {
    findStaleRollupMismatches,
    type StaleRollupMismatch,
} from "../../packages/cron-jobs/src/reconcileStaleCustomerRollups";
import { recalculateCustomerAmountsViaApi } from "../../packages/cron-jobs/src/customersDomain";

const LOG = "[repair-stale-rollups]";

if (!process.env.CUSTOMERS_DOMAIN_ROOT) {
    process.env.CUSTOMERS_DOMAIN_ROOT = path.resolve(
        __dirname,
        "../../api/dist/customers"
    );
}

type Args = {
    dryRun: boolean;
    fix: boolean;
    accountId: number | null;
    customerIds: number[];
    /** When true, any due/overdue count mismatch; else fully-stale overdue only. */
    allMismatches: boolean;
    limit: number;
};

function parsePositiveInt(raw: string | undefined, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${flag} requires a positive integer`);
    }
    return value;
}

function parseArgs(argv: string[]): Args {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }

    const accountIdx = argv.indexOf("--account");
    const accountId =
        accountIdx === -1
            ? null
            : parsePositiveInt(argv[accountIdx + 1], "--account");

    const customerIds: number[] = [];
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--customer" || argv[i] === "--customers") {
            const raw = argv[i + 1];
            if (!raw) {
                throw new Error(`${argv[i]} requires id or comma-separated ids`);
            }
            for (const part of raw.split(",")) {
                customerIds.push(parsePositiveInt(part.trim(), argv[i]!));
            }
            i += 1;
        }
    }

    const limitIdx = argv.indexOf("--limit");
    const limit =
        limitIdx === -1
            ? 5000
            : parsePositiveInt(argv[limitIdx + 1], "--limit");

    return {
        dryRun,
        fix,
        accountId,
        customerIds,
        allMismatches: argv.includes("--all-mismatches"),
        limit,
    };
}

function summarize(rows: StaleRollupMismatch[]) {
    return {
        count: rows.length,
        accountIds: [...new Set(rows.map((r) => r.accountId))].sort(
            (a, b) => a - b
        ),
        sampleCustomerIds: rows.slice(0, 25).map((r) => r.customerId),
    };
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const mismatches = await findStaleRollupMismatches(prisma, {
            limit: args.limit,
            accountId: args.accountId ?? undefined,
            customerIds:
                args.customerIds.length > 0 ? args.customerIds : undefined,
            fullyStaleOverdueOnly: !args.allMismatches,
        });

        console.log(`${LOG} scan`, {
            mode: args.fix ? "fix" : "dry-run",
            accountId: args.accountId,
            customerFilterCount: args.customerIds.length,
            fullyStaleOverdueOnly: !args.allMismatches,
            limit: args.limit,
            ...summarize(mismatches),
        });

        if (mismatches.length === 0) {
            console.log(`${LOG} nothing to repair`);
            return;
        }

        if (args.dryRun) {
            console.log(`${LOG} dry-run sample`, mismatches.slice(0, 10));
            return;
        }

        const customerIds = mismatches.map((row) => row.customerId);
        await recalculateCustomerAmountsViaApi(customerIds, prisma);

        const remaining = await findStaleRollupMismatches(prisma, {
            limit: Math.min(args.limit, customerIds.length + 50),
            accountId: args.accountId ?? undefined,
            customerIds,
            fullyStaleOverdueOnly: !args.allMismatches,
        });

        console.log(`${LOG} recalculated`, {
            customersRecalculated: customerIds.length,
            stillMismatched: remaining.length,
            stillSampleCustomerIds: remaining
                .slice(0, 20)
                .map((r) => r.customerId),
        });
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LOG} failed:`, message);
    process.exitCode = 1;
});
