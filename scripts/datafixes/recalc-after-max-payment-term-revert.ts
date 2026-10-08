/**
 * Follow-up after revert-max-payment-term-180-to-120:
 * 1) Refresh live open-invoice terms flags for affected customers
 * 2) Enqueue + drain as-of rewrite for those customers from their
 *    policy_change_start_date through today (CPT + dashboard tip)
 *
 * Selects active CustomerPolicy rows on the account that were updated in the
 * last few hours to max_payment_term = 120 (the in-place revert cohort).
 *
 * Usage:
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/recalc-after-max-payment-term-revert.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/recalc-after-max-payment-term-revert.ts --account 10149 --fix
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    drainAsOfRewriteQueue,
    enqueueAsOfRewrite,
    refreshTermsBreachFlagsForCustomers,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";

const LOG = "[recalc-after-max-payment-term-revert]";
const LOOKBACK_HOURS = 6;

type Args = { accountId: number; dryRun: boolean; fix: boolean };

type CohortRow = {
    customer_id: number;
    customer_policy_id: number;
    policy_change_start_date: Date;
};

function parseArgs(argv: string[]): Args {
    const dryRun = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRun === fix) {
        throw new Error("Pass exactly one of --dry-run or --fix");
    }
    const idx = argv.indexOf("--account");
    const accountId = Number(idx === -1 ? NaN : argv[idx + 1]);
    if (!Number.isInteger(accountId) || accountId <= 0) {
        throw new Error("Pass --account <positive account id>");
    }
    return { accountId, dryRun, fix };
}

async function loadCohort(
    prisma: PrismaClient,
    accountId: number
): Promise<CohortRow[]> {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
    return prisma.$queryRaw<CohortRow[]>`
        SELECT
            cp.customer_id,
            cp.id AS customer_policy_id,
            cp.policy_change_start_date
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        WHERE c.account_id = ${accountId}
          AND cp.is_active = true
          AND cp.max_payment_term = 120
          AND cp.modified_at >= ${since}
        ORDER BY cp.customer_id ASC
    `;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    console.log(`${LOG} starting`, {
        accountId: args.accountId,
        mode: args.dryRun ? "dry-run" : "fix",
        lookbackHours: LOOKBACK_HOURS,
    });

    try {
        const cohort = await loadCohort(prisma, args.accountId);
        const customerIds = [...new Set(cohort.map((r) => r.customer_id))];
        let fromDate = startOfTodayUtc();
        for (const row of cohort) {
            const day = new Date(
                Date.UTC(
                    row.policy_change_start_date.getUTCFullYear(),
                    row.policy_change_start_date.getUTCMonth(),
                    row.policy_change_start_date.getUTCDate()
                )
            );
            if (day.getTime() < fromDate.getTime()) {
                fromDate = day;
            }
        }
        const toDate = startOfTodayUtc();

        console.log(`${LOG} cohort`, {
            customerPolicyRows: cohort.length,
            uniqueCustomers: customerIds.length,
            fromDate: fromDate.toISOString().slice(0, 10),
            toDate: toDate.toISOString().slice(0, 10),
            sampleCustomerIds: customerIds.slice(0, 10),
        });

        if (customerIds.length === 0) {
            console.log(`${LOG} nothing to do`);
            return;
        }

        if (args.dryRun) {
            console.log(`${LOG} dry-run complete; no writes`);
            return;
        }

        const invoiceFlagsUpdated = await refreshTermsBreachFlagsForCustomers(
            customerIds,
            prisma,
            {
                onProgress: ({ processed, total }) => {
                    if (processed === total || processed % 5 === 0) {
                        console.log(`${LOG} terms refresh progress`, {
                            processed,
                            total,
                        });
                    }
                },
            }
        );
        console.log(`${LOG} live terms refresh done`, {
            invoiceFlagsUpdated,
            customers: customerIds.length,
        });

        await enqueueAsOfRewrite(
            {
                accountId: args.accountId,
                customerIds,
                fromDate,
                toDate,
            },
            prisma
        );
        console.log(`${LOG} as-of rewrite enqueued`);

        const drain = await drainAsOfRewriteQueue({
            dbClient: prisma,
            maxItems: 5,
        });
        console.log(`${LOG} as-of rewrite drain`, drain);
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(`${LOG} failed`, {
        errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
});
