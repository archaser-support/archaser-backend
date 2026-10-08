/**
 * Data fix: set policy_change_end_date on inactive CustomerPolicy versions so
 * the most recently saved change wins from its start date onward.
 *
 * For each inactive version V (with a policy, not pending/cancelled-pending):
 *   end(V) = max(start(V), min(start(W) for W saved after V))
 * where "saved after" orders by created_at, id. A backdated version therefore
 * voids (end = start) older-saved versions that start on/after its date.
 *
 * Left unchanged: active rows, versions with no later-saved version, and
 * dated-unassign end dates (an end that is not another version's start is
 * only ever shortened).
 *
 * With --fix, each changed customer's CustomerPolicyTrend is rewritten from
 * the earliest changed day to today. Pool roots are remirrored first (that
 * only replaces children's live rows; a linked child's own history is
 * repaired like any other customer).
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --account 10149 --dry-run
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --account 10149 --customer 21252 --fix
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/backfill-customer-policy-end-dates.ts --all --dry-run
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    remirrorCreditPoolAfterPolicyMutation,
    rewriteCustomerAsOfRange,
} from "@archaser/credit-insurance-domain";

const LOG = "[backfill-customer-policy-end-dates]";
const DAY_MS = 24 * 60 * 60 * 1000;

type Args = {
    dryRun: boolean;
    fix: boolean;
    accountId: number | null;
    allAccounts: boolean;
    customerIds: number[];
};

type VersionRow = {
    id: number;
    customer_id: number;
    account_id: number;
    parent_customer_id: number | null;
    insurance_policy_id: number | null;
    limit_type: string | null;
    status: string;
    is_active: boolean;
    policy_change_start_date: Date;
    policy_change_end_date: Date | null;
    created_at: Date;
};

type PlannedChange = {
    id: number;
    customerId: number;
    accountId: number;
    limitType: string | null;
    start: Date;
    oldEnd: Date | null;
    newEnd: Date;
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
    const customerIds: number[] = [];
    argv.forEach((arg, i) => {
        if (arg === "--customer") {
            customerIds.push(parsePositiveInt(argv[i + 1], "--customer"));
        }
    });
    return { dryRun, fix, accountId, allAccounts, customerIds };
}

const ymd = (d: Date | null) => (d == null ? "—" : d.toISOString().slice(0, 10));
const dayMs = (d: Date) => Math.floor(d.getTime() / DAY_MS) * DAY_MS;

async function loadVersions(
    prisma: PrismaClient,
    args: Args
): Promise<VersionRow[]> {
    const accountFilter =
        args.accountId == null
            ? Prisma.empty
            : Prisma.sql`AND c.account_id = ${args.accountId}`;
    const customerFilter =
        args.customerIds.length === 0
            ? Prisma.empty
            : Prisma.sql`AND c.id = ANY(${args.customerIds}::int[])`;
    return prisma.$queryRaw<VersionRow[]>`
        SELECT cp.id, cp.customer_id, c.account_id, c.parent_customer_id,
               cp.insurance_policy_id, cp.limit_type::text AS limit_type,
               cp.status::text AS status, cp.is_active,
               cp.policy_change_start_date, cp.policy_change_end_date,
               cp.created_at
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        WHERE TRUE ${accountFilter} ${customerFilter}
        ORDER BY cp.customer_id, cp.created_at, cp.id
    `;
}

/** Cancelled pending rows were never live: inactive, no end, scheduled for a later day. */
function isCancelledPending(row: VersionRow): boolean {
    return (
        !row.is_active &&
        row.policy_change_end_date == null &&
        dayMs(row.policy_change_start_date) > dayMs(row.created_at)
    );
}

function planCustomer(rows: VersionRow[]): PlannedChange[] {
    const versions = rows.filter(
        (row) =>
            row.insurance_policy_id != null &&
            row.status !== "pending" &&
            !isCancelledPending(row)
    );
    const startDays = new Set(versions.map((row) => dayMs(row.policy_change_start_date)));
    const changes: PlannedChange[] = [];

    versions.forEach((row, index) => {
        if (row.is_active) {
            return;
        }
        const laterStarts = versions
            .slice(index + 1)
            .map((later) => dayMs(later.policy_change_start_date));
        if (laterStarts.length === 0) {
            return;
        }
        const startMs = dayMs(row.policy_change_start_date);
        let newEndMs = Math.max(startMs, Math.min(...laterStarts));

        const oldEnd = row.policy_change_end_date;
        if (oldEnd != null) {
            const oldEndMs = dayMs(oldEnd);
            const isUnassignEnd = !startDays.has(oldEndMs);
            if (isUnassignEnd) {
                newEndMs = Math.min(newEndMs, Math.max(startMs, oldEndMs));
            }
            if (oldEndMs === newEndMs) {
                return;
            }
        }
        changes.push({
            id: row.id,
            customerId: row.customer_id,
            accountId: row.account_id,
            limitType: row.limit_type,
            start: row.policy_change_start_date,
            oldEnd,
            newEnd: new Date(newEndMs),
        });
    });
    return changes;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    console.log(`${LOG} starting`, {
        mode: args.dryRun ? "dry-run" : "fix",
        accountId: args.accountId,
        allAccounts: args.allAccounts,
        customerIds: args.customerIds,
    });

    try {
        const rows = await loadVersions(prisma, args);
        const byCustomer = new Map<number, VersionRow[]>();
        for (const row of rows) {
            const bucket = byCustomer.get(row.customer_id) ?? [];
            bucket.push(row);
            byCustomer.set(row.customer_id, bucket);
        }

        const changesByCustomer = new Map<number, PlannedChange[]>();
        const linkedChildIds = new Set<number>();
        for (const [customerId, customerRows] of byCustomer) {
            if (customerRows[0]!.parent_customer_id != null) {
                linkedChildIds.add(customerId);
            }
            const changes = planCustomer(customerRows);
            if (changes.length > 0) {
                changesByCustomer.set(customerId, changes);
            }
        }

        const totalChanges = [...changesByCustomer.values()].reduce(
            (sum, list) => sum + list.length,
            0
        );
        console.log(`${LOG} plan`, {
            customers: changesByCustomer.size,
            versions: totalChanges,
        });
        for (const [customerId, changes] of changesByCustomer) {
            console.log(
                `${LOG} customer ${customerId}${linkedChildIds.has(customerId) ? " (linked child)" : ""}`
            );
            for (const c of changes) {
                const voided = dayMs(c.newEnd) === dayMs(c.start) ? " (void)" : "";
                console.log(
                    `    version ${c.id} ${c.limitType ?? ""} start ${ymd(c.start)}: end ${ymd(c.oldEnd)} → ${ymd(c.newEnd)}${voided}`
                );
            }
        }

        if (args.dryRun) {
            console.log(`${LOG} dry-run complete; no writes`);
            return;
        }

        let updated = 0;
        let rewriteFailures = 0;
        for (const [customerId, changes] of changesByCustomer) {
            await prisma.$transaction(
                changes.map((c) =>
                    prisma.customerPolicy.update({
                        where: { id: c.id },
                        data: { policy_change_end_date: c.newEnd },
                    })
                )
            );
            updated += changes.length;

            const accountId = changes[0]!.accountId;
            const fromDate = new Date(
                Math.min(
                    ...changes.map((c) =>
                        Math.min(dayMs(c.newEnd), c.oldEnd == null ? Infinity : dayMs(c.oldEnd))
                    )
                )
            );
            const remirror = linkedChildIds.has(customerId)
                ? { mirroredCustomerIds: [] as number[] }
                : await remirrorCreditPoolAfterPolicyMutation(customerId, accountId, {
                      dbClient: prisma,
                  });
            try {
                const result = await rewriteCustomerAsOfRange(
                    {
                        accountId,
                        customerIds: [customerId, ...remirror.mirroredCustomerIds],
                        fromDate,
                        toDate: new Date(),
                    },
                    { dbClient: prisma }
                );
                console.log(`${LOG} rewritten`, {
                    customerId,
                    mirroredCustomerIds: remirror.mirroredCustomerIds,
                    fromDate: ymd(fromDate),
                    daysRewritten: result.daysRewritten,
                });
            } catch (error) {
                rewriteFailures += 1;
                console.error(`${LOG} rewrite failed`, {
                    customerId,
                    fromDate: ymd(fromDate),
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            }
        }

        console.log(`${LOG} fixed`, {
            versionsUpdated: updated,
            customers: changesByCustomer.size,
            rewriteFailures,
        });
        if (rewriteFailures > 0) {
            process.exitCode = 1;
        }
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
