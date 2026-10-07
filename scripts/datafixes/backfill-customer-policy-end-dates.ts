/**
 * One-time data fix: set policy_change_end_date on superseded inactive
 * CustomerPolicy rows that still have a null end date.
 *
 * For each inactive null-end row, end_date = the next version's
 * policy_change_start_date (same customer; next by start date then id).
 * Orphans (no later successor) are left unchanged.
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --account 10149 --fix
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --all --fix
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const LOG = "[backfill-customer-policy-end-dates]";

type Args = {
    dryRun: boolean;
    fix: boolean;
    accountId: number | null;
    allAccounts: boolean;
};

type TargetRow = {
    id: number;
    customer_id: number;
    account_id: number;
    policy_change_start_date: Date;
    next_start_date: Date;
    next_id: number;
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
    const allAccounts = argv.includes("--all");
    const accountIdx = argv.indexOf("--account");
    const accountId =
        accountIdx === -1
            ? null
            : parsePositiveInt(argv[accountIdx + 1], "--account");
    if (allAccounts === (accountId != null)) {
        throw new Error("Pass exactly one of --account <id> or --all");
    }
    return { dryRun, fix, accountId, allAccounts };
}

async function findTargets(
    prisma: PrismaClient,
    accountId: number | null
): Promise<TargetRow[]> {
    const accountFilter =
        accountId == null
            ? Prisma.empty
            : Prisma.sql`AND c.account_id = ${accountId}`;

    return prisma.$queryRaw<TargetRow[]>`
        SELECT
            cp.id,
            cp.customer_id,
            c.account_id,
            cp.policy_change_start_date,
            nxt.policy_change_start_date AS next_start_date,
            nxt.id AS next_id
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        INNER JOIN LATERAL (
            SELECT p.id, p.policy_change_start_date
            FROM "CustomerPolicy" p
            WHERE p.customer_id = cp.customer_id
              AND (
                p.policy_change_start_date > cp.policy_change_start_date
                OR (
                  p.policy_change_start_date = cp.policy_change_start_date
                  AND p.id > cp.id
                )
              )
            ORDER BY p.policy_change_start_date ASC, p.id ASC
            LIMIT 1
        ) nxt ON TRUE
        WHERE cp.is_active = false
          AND cp.policy_change_end_date IS NULL
          ${accountFilter}
        ORDER BY c.account_id ASC, cp.customer_id ASC, cp.id ASC
    `;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    console.log(`${LOG} starting`, {
        mode: args.dryRun ? "dry-run" : "fix",
        accountId: args.accountId,
        allAccounts: args.allAccounts,
    });

    try {
        const targets = await findTargets(prisma, args.accountId);
        const byAccount = new Map<number, number>();
        for (const row of targets) {
            byAccount.set(
                row.account_id,
                (byAccount.get(row.account_id) ?? 0) + 1
            );
        }
        console.log(`${LOG} targets`, {
            rows: targets.length,
            accounts: byAccount.size,
            sample: targets.slice(0, 15).map((r) => ({
                id: r.id,
                customerId: r.customer_id,
                accountId: r.account_id,
                endDate: r.next_start_date.toISOString().slice(0, 10),
                nextId: r.next_id,
            })),
            perAccount: Object.fromEntries(byAccount),
        });

        if (args.dryRun) {
            console.log(`${LOG} dry-run complete; no writes`);
            return;
        }

        let updated = 0;
        const chunkSize = 500;
        for (let i = 0; i < targets.length; i += chunkSize) {
            const chunk = targets.slice(i, i + chunkSize);
            await prisma.$transaction(
                chunk.map((row) =>
                    prisma.customerPolicy.update({
                        where: { id: row.id },
                        data: {
                            policy_change_end_date: row.next_start_date,
                        },
                    })
                )
            );
            updated += chunk.length;
            console.log(`${LOG} progress`, {
                updated,
                total: targets.length,
            });
        }

        console.log(`${LOG} fixed`, { rowsUpdated: updated });
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
