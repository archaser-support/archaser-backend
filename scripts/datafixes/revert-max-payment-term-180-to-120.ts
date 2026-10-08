/**
 * One-time data fix: rewrite CustomerPolicy.max_payment_term from 180 → 120
 * in place (no new versions) for rows that changed away from a prior 120.
 *
 * Selection: a CustomerPolicy row with max_payment_term = 180 whose
 * immediately previous version for the same customer (highest id < this id)
 * had max_payment_term = 120.
 *
 * Also rewrites matching CustomerPolicyTrend.max_payment_term on those
 * customers, and optionally InsurancePolicy.max_payment_term 180 → 120
 * when --also-policy is passed.
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/revert-max-payment-term-180-to-120.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/revert-max-payment-term-180-to-120.ts --account 10149 --fix
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/revert-max-payment-term-180-to-120.ts --account 10149 --fix --also-policy
 *
 * Does not log secrets or connection strings.
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const LOG = "[revert-max-payment-term-180-to-120]";
const FROM_TERM = 180;
const TO_TERM = 120;

type Args = {
    dryRun: boolean;
    fix: boolean;
    accountId: number;
    alsoPolicy: boolean;
    insurancePolicyId: number | null;
};

type TargetRow = {
    id: number;
    customer_id: number;
    status: string;
    is_active: boolean;
    max_payment_term: number | null;
    previous_id: number;
    previous_max_payment_term: number | null;
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
    if (accountIdx === -1) {
        throw new Error("Pass --account <positive account id>");
    }
    const accountId = parsePositiveInt(argv[accountIdx + 1], "--account");

    const policyIdx = argv.indexOf("--insurance-policy");
    const insurancePolicyId =
        policyIdx === -1
            ? null
            : parsePositiveInt(argv[policyIdx + 1], "--insurance-policy");

    return {
        dryRun,
        fix,
        accountId,
        alsoPolicy: argv.includes("--also-policy"),
        insurancePolicyId,
    };
}

async function findTargetRows(
    prisma: PrismaClient,
    accountId: number,
    insurancePolicyId: number | null
): Promise<TargetRow[]> {
    const policyFilter =
        insurancePolicyId == null
            ? Prisma.empty
            : Prisma.sql`AND cp.insurance_policy_id = ${insurancePolicyId}`;

    return prisma.$queryRaw<TargetRow[]>`
        SELECT
            cp.id,
            cp.customer_id,
            cp.status::text AS status,
            cp.is_active,
            cp.max_payment_term,
            prev.id AS previous_id,
            prev.max_payment_term AS previous_max_payment_term
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        INNER JOIN LATERAL (
            SELECT p.id, p.max_payment_term
            FROM "CustomerPolicy" p
            WHERE p.customer_id = cp.customer_id
              AND p.id < cp.id
            ORDER BY p.id DESC
            LIMIT 1
        ) prev ON TRUE
        WHERE c.account_id = ${accountId}
          AND cp.max_payment_term = ${FROM_TERM}
          AND prev.max_payment_term = ${TO_TERM}
          ${policyFilter}
        ORDER BY cp.customer_id ASC, cp.id ASC
    `;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    console.log(`${LOG} starting`, {
        accountId: args.accountId,
        mode: args.dryRun ? "dry-run" : "fix",
        alsoPolicy: args.alsoPolicy,
        insurancePolicyId: args.insurancePolicyId,
        from: FROM_TERM,
        to: TO_TERM,
    });

    try {
        const targets = await findTargetRows(
            prisma,
            args.accountId,
            args.insurancePolicyId
        );

        const customerIds = [...new Set(targets.map((r) => r.customer_id))];
        console.log(`${LOG} targets`, {
            customerPolicyRows: targets.length,
            uniqueCustomers: customerIds.length,
            sample: targets.slice(0, 20).map((r) => ({
                customerPolicyId: r.id,
                customerId: r.customer_id,
                status: r.status,
                isActive: r.is_active,
                previousId: r.previous_id,
            })),
        });

        if (args.dryRun) {
            if (args.alsoPolicy) {
                const policies = await prisma.insurancePolicy.findMany({
                    where: {
                        account_id: args.accountId,
                        max_payment_term: FROM_TERM,
                        ...(args.insurancePolicyId
                            ? { id: args.insurancePolicyId }
                            : {}),
                    },
                    select: {
                        id: true,
                        policy_number: true,
                        max_payment_term: true,
                    },
                });
                console.log(
                    `${LOG} dry-run insurance policies that would update`,
                    {
                        count: policies.length,
                        policies,
                    }
                );
            }
            console.log(`${LOG} dry-run complete; no writes`);
            return;
        }

        const targetIds = targets.map((r) => r.id);
        const updatedPolicies =
            targetIds.length === 0
                ? { count: 0 }
                : await prisma.customerPolicy.updateMany({
                      where: {
                          id: { in: targetIds },
                          max_payment_term: FROM_TERM,
                      },
                      data: { max_payment_term: TO_TERM },
                  });

        const updatedTrends =
            customerIds.length === 0
                ? { count: 0 }
                : await prisma.customerPolicyTrend.updateMany({
                      where: {
                          account_id: args.accountId,
                          customer_id: { in: customerIds },
                          max_payment_term: FROM_TERM,
                      },
                      data: { max_payment_term: TO_TERM },
                  });

        let updatedInsurancePolicies = { count: 0 };
        if (args.alsoPolicy) {
            updatedInsurancePolicies = await prisma.insurancePolicy.updateMany({
                where: {
                    account_id: args.accountId,
                    max_payment_term: FROM_TERM,
                    ...(args.insurancePolicyId
                        ? { id: args.insurancePolicyId }
                        : {}),
                },
                data: { max_payment_term: TO_TERM },
            });
        }

        console.log(`${LOG} fixed`, {
            customerPolicyRowsUpdated: updatedPolicies.count,
            customerPolicyTrendRowsUpdated: updatedTrends.count,
            insurancePolicyRowsUpdated: updatedInsurancePolicies.count,
        });
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
