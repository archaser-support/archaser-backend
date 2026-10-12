/**
 * Align CustomerPolicy + CustomerPolicyTrend registration_fee_percent to the
 * linked InsurancePolicy value so Portfolio Health monthly costs include the
 * registration markup.
 *
 * Updates every CustomerPolicy row on the policy (active and historical) and
 * matching CPT days in the date window. Does not invent a rate when the master
 * policy registration_fee_percent is null.
 *
 * Usage:
 *   npx tsx scripts/datafixes/align-registration-fee-from-policy.ts --account 10149 --dry-run
 *   npx tsx scripts/datafixes/align-registration-fee-from-policy.ts --account 10149 --run
 *   npx tsx scripts/datafixes/align-registration-fee-from-policy.ts --account 10149 --policy 123 --from 2026-01-01 --to 2026-09-30 --run
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const LOG = "[align-registration-fee-from-policy]";

function parsePositiveInt(value: string | undefined, flag: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`${flag} <id> is required`);
    }
    return n;
}

function parseYmd(value: string | undefined, flag: string): Date | null {
    if (value == null || value.trim() === "") {
        return null;
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) {
        throw new Error(`${flag} must be YYYY-MM-DD`);
    }
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function parseArgs(argv: string[]): {
    accountId: number;
    policyId: number | null;
    dryRun: boolean;
    run: boolean;
    fromDate: Date | null;
    toDate: Date | null;
} {
    const accountId = parsePositiveInt(
        argv[argv.indexOf("--account") + 1],
        "--account"
    );
    const policyIdx = argv.indexOf("--policy");
    const policyId =
        policyIdx === -1
            ? null
            : parsePositiveInt(argv[policyIdx + 1], "--policy");
    const dryRun = argv.includes("--dry-run");
    const run = argv.includes("--run");
    if (dryRun === run) {
        throw new Error("Pass exactly one of --dry-run or --run");
    }
    const fromIdx = argv.indexOf("--from");
    const toIdx = argv.indexOf("--to");
    return {
        accountId,
        policyId,
        dryRun,
        run,
        fromDate: parseYmd(
            fromIdx === -1 ? undefined : argv[fromIdx + 1],
            "--from"
        ),
        toDate: parseYmd(toIdx === -1 ? undefined : argv[toIdx + 1], "--to"),
    };
}

type MismatchRow = {
    insurance_policy_id: number;
    policy_registration_fee_percent: Prisma.Decimal | null;
    customer_policy_mismatch_count: bigint;
    cpt_mismatch_count: bigint;
};

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const account = await prisma.account.findUnique({
            where: { id: args.accountId },
            select: { id: true, name: true, has_credit_insurance: true },
        });
        if (!account) {
            throw new Error(`account ${args.accountId} not found`);
        }
        if (!account.has_credit_insurance) {
            throw new Error(
                `account ${args.accountId} does not have credit insurance enabled`
            );
        }

        const policyFilter =
            args.policyId == null
                ? Prisma.empty
                : Prisma.sql`AND ip.id = ${args.policyId}`;

        const fromDate = args.fromDate;
        const toDate = args.toDate;
        const cptDateFilter =
            fromDate != null && toDate != null
                ? Prisma.sql`AND t.snapshot_date >= ${fromDate}::date AND t.snapshot_date <= ${toDate}::date`
                : fromDate != null
                  ? Prisma.sql`AND t.snapshot_date >= ${fromDate}::date`
                  : toDate != null
                    ? Prisma.sql`AND t.snapshot_date <= ${toDate}::date`
                    : Prisma.empty;

        const preview = await prisma.$queryRaw<MismatchRow[]>`
            SELECT
                ip.id AS insurance_policy_id,
                ip.registration_fee_percent AS policy_registration_fee_percent,
                (
                    SELECT COUNT(*)::bigint
                    FROM "CustomerPolicy" cp
                    WHERE cp.insurance_policy_id = ip.id
                      AND cp.registration_fee_percent IS DISTINCT FROM ip.registration_fee_percent
                ) AS customer_policy_mismatch_count,
                (
                    SELECT COUNT(*)::bigint
                    FROM "CustomerPolicyTrend" t
                    WHERE t.account_id = ip.account_id
                      AND t.insurance_policy_id = ip.id
                      AND t.registration_fee_percent IS DISTINCT FROM ip.registration_fee_percent
                      ${cptDateFilter}
                ) AS cpt_mismatch_count
            FROM "InsurancePolicy" ip
            WHERE ip.account_id = ${args.accountId}
              AND ip.registration_fee_percent IS NOT NULL
              ${policyFilter}
            ORDER BY ip.id
        `;

        const actionable = preview.filter(
            (row) =>
                Number(row.customer_policy_mismatch_count) > 0 ||
                Number(row.cpt_mismatch_count) > 0
        );

        console.log(
            JSON.stringify(
                {
                    log: LOG,
                    mode: args.dryRun ? "dry-run" : "run",
                    accountId: account.id,
                    accountName: account.name,
                    policyId: args.policyId,
                    fromDate: fromDate?.toISOString().slice(0, 10) ?? null,
                    toDate: toDate?.toISOString().slice(0, 10) ?? null,
                    policiesWithRegistrationFee: preview.length,
                    policiesNeedingFix: actionable.length,
                    preview: actionable.map((row) => ({
                        insurancePolicyId: row.insurance_policy_id,
                        policyRegistrationFeePercent: Number(
                            row.policy_registration_fee_percent
                        ),
                        customerPolicyMismatchCount: Number(
                            row.customer_policy_mismatch_count
                        ),
                        cptMismatchCount: Number(row.cpt_mismatch_count),
                    })),
                },
                null,
                2
            )
        );

        if (args.dryRun || actionable.length === 0) {
            return;
        }

        const result = await prisma.$transaction(async (tx) => {
            const cpResult = await tx.$executeRaw`
                UPDATE "CustomerPolicy" cp
                SET
                    registration_fee_percent = ip.registration_fee_percent,
                    modified_at = NOW()
                FROM "InsurancePolicy" ip
                WHERE ip.id = cp.insurance_policy_id
                  AND ip.account_id = ${args.accountId}
                  AND ip.registration_fee_percent IS NOT NULL
                  AND cp.registration_fee_percent IS DISTINCT FROM ip.registration_fee_percent
                  ${
                      args.policyId == null
                          ? Prisma.empty
                          : Prisma.sql`AND ip.id = ${args.policyId}`
                  }
            `;

            const cptResult = await tx.$executeRaw`
                UPDATE "CustomerPolicyTrend" t
                SET registration_fee_percent = ip.registration_fee_percent
                FROM "InsurancePolicy" ip
                WHERE ip.id = t.insurance_policy_id
                  AND ip.account_id = ${args.accountId}
                  AND t.account_id = ${args.accountId}
                  AND ip.registration_fee_percent IS NOT NULL
                  AND t.registration_fee_percent IS DISTINCT FROM ip.registration_fee_percent
                  ${
                      args.policyId == null
                          ? Prisma.empty
                          : Prisma.sql`AND ip.id = ${args.policyId}`
                  }
                  ${cptDateFilter}
            `;

            return {
                customerPolicyRowsUpdated: Number(cpResult),
                cptRowsUpdated: Number(cptResult),
            };
        });

        console.log(
            JSON.stringify(
                {
                    log: LOG,
                    applied: true,
                    ...result,
                },
                null,
                2
            )
        );
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error(LOG, error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
