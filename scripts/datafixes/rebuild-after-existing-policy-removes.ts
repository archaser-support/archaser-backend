/**
 * Data fix: rebuild policy chart and dashboard days for customers whose
 * insurance policy was removed (dated unassign) before Remove did so itself.
 *
 * A removed customer has an inactive version V with a policy and
 * end(V) > start(V), and no live version (non-pending, not cancelled pending,
 * with a policy, not voided) starting on end(V) — the same "Removed" rule as
 * Policy history. The remove date is end(V). Customers who were assigned a
 * policy again on a later day are included.
 *
 * Removed-row migration (grill D34): Remove now saves one Removed row (no
 * policy, inactive, open end) and leaves older versions unchanged. For each
 * remove found above, --fix:
 *   - restores end dates the old Remove wrote (end = remove day on earlier
 *     versions, end = start on voided later ones) to the next version's start
 *     (null for the last one), without changing modified_at / modified_by;
 *   - adds the missing Removed row on the remove day, stamped with the
 *     remove's modified at / by;
 *   - strips the policy from invoices dated before the first version (no
 *     prehistory coverage once removed).
 * Customers assigned a policy again after the remove keep their old end dates
 * (a Removed row added now would also stop the later assignment).
 * Run after migration 20261011_void_cancelled_pending_unassign.sql.
 *
 * With --fix, per account (skipped while a credit as-of backfill or pool
 * parent-history job holds the snapshot lease):
 *   - each affected policy's InsurancePolicyTrend is rolled up from Customer
 *     Policy Trend rows from its earliest remove date through today;
 *   - one rewrite-queue entry covers the removed customers and their credit
 *     pool descendants from the earliest remove date through today (the
 *     overnight drain rebuilds the credit dashboard days).
 * Both steps are idempotent; the queue merges into the account's pending row.
 *
 * Usage (from backend repo root):
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/rebuild-after-existing-policy-removes.ts --account 10149
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/rebuild-after-existing-policy-removes.ts --account 10149 --customer 21108 --fix
 *   node ./scripts/run-with-env.cjs npx tsx ./scripts/datafixes/rebuild-after-existing-policy-removes.ts --all --fix
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    enqueueAsOfRewrite,
    listDescendantCustomerIds,
    loadAccountSnapshotLeaseBlockers,
    rollUpInsurancePolicyTrendFromCustomerPolicyTrend,
    startOfTodayUtc,
    stripInvoicePolicyStampsFromUnassignDay,
} from "@archaser/credit-insurance-domain";

const LOG = "[rebuild-after-existing-policy-removes]";
const DAY_MS = 24 * 60 * 60 * 1000;

type Args = {
    dryRun: boolean;
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
    policy_number: string | null;
    status: string;
    is_active: boolean;
    policy_change_start_date: Date;
    policy_change_end_date: Date | null;
    created_at: Date;
    modified_at: Date;
    modified_by: string | null;
};

type RemovedVersion = {
    versionId: number;
    customerId: number;
    accountId: number;
    linkedChild: boolean;
    policyId: number;
    policyNumber: string | null;
    removeDate: Date;
};

type EndDateRestore = {
    versionId: number;
    fromEnd: Date | null;
    toEnd: Date | null;
};

type RemovedRowMigration = {
    removed: RemovedVersion;
    /** null: assigned again after the remove; old end dates are kept. */
    restores: EndDateRestore[] | null;
    addRemovedRow: boolean;
    modifiedAt: Date;
    modifiedBy: string | null;
};

function parsePositiveInt(raw: string | undefined, flag: string): number {
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${flag} requires a positive integer`);
    }
    return value;
}

function parseArgs(argv: string[]): Args {
    const dryRunFlag = argv.includes("--dry-run");
    const fix = argv.includes("--fix");
    if (dryRunFlag && fix) {
        throw new Error("Pass at most one of --dry-run or --fix");
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
    return { dryRun: !fix, accountId, allAccounts, customerIds };
}

const ymd = (d: Date | null) => (d == null ? "—" : d.toISOString().slice(0, 10));
const dayMs = (d: Date) => Math.floor(d.getTime() / DAY_MS) * DAY_MS;
const daysThrough = (from: Date, to: Date) =>
    Math.max(0, Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1);

async function loadCandidateVersions(
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
               cp.insurance_policy_id, ip.policy_number,
               cp.status::text AS status, cp.is_active,
               cp.policy_change_start_date, cp.policy_change_end_date,
               cp.created_at, cp.modified_at, cp.modified_by
        FROM "CustomerPolicy" cp
        INNER JOIN "Customer" c ON c.id = cp.customer_id
        INNER JOIN "Account" a ON a.id = c.account_id
        LEFT JOIN "InsurancePolicy" ip ON ip.id = cp.insurance_policy_id
        WHERE a.has_credit_insurance = TRUE
          ${accountFilter} ${customerFilter}
          AND EXISTS (
            SELECT 1 FROM "CustomerPolicy" ended
            WHERE ended.customer_id = cp.customer_id
              AND ended.is_active = FALSE
              AND ended.status <> 'pending'
              AND ended.insurance_policy_id IS NOT NULL
              AND ended.policy_change_end_date > ended.policy_change_start_date
          )
        ORDER BY c.account_id, cp.customer_id, cp.policy_change_start_date, cp.id
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

function isVoided(row: VersionRow): boolean {
    return (
        row.policy_change_end_date != null &&
        dayMs(row.policy_change_end_date) === dayMs(row.policy_change_start_date)
    );
}

function findRemovedVersions(rows: VersionRow[], todayMs: number): RemovedVersion[] {
    const live = rows.filter(
        (row) =>
            row.status !== "pending" &&
            row.insurance_policy_id != null &&
            !isVoided(row) &&
            !isCancelledPending(row)
    );
    const removed: RemovedVersion[] = [];
    for (const row of rows) {
        if (
            row.is_active ||
            row.status === "pending" ||
            row.insurance_policy_id == null ||
            row.policy_change_end_date == null
        ) {
            continue;
        }
        const endMs = dayMs(row.policy_change_end_date);
        if (endMs <= dayMs(row.policy_change_start_date) || endMs > todayMs) {
            continue;
        }
        const superseded = live.some(
            (other) => other !== row && dayMs(other.policy_change_start_date) === endMs
        );
        if (superseded) {
            continue;
        }
        removed.push({
            versionId: row.id,
            customerId: row.customer_id,
            accountId: row.account_id,
            linkedChild: row.parent_customer_id != null,
            policyId: row.insurance_policy_id,
            policyNumber: row.policy_number,
            removeDate: new Date(endMs),
        });
    }
    return removed;
}

function isRemovedRowShape(row: VersionRow): boolean {
    return (
        row.insurance_policy_id == null &&
        !row.is_active &&
        row.status === "inactive" &&
        row.policy_change_end_date == null
    );
}

const byStartThenId = (a: VersionRow, b: VersionRow) =>
    dayMs(a.policy_change_start_date) - dayMs(b.policy_change_start_date) ||
    a.id - b.id;

function planRemovedRowMigrations(
    rows: VersionRow[],
    removedList: RemovedVersion[]
): RemovedRowMigration[] {
    const policyVersions = rows.filter(
        (row) =>
            row.status !== "pending" &&
            row.insurance_policy_id != null &&
            !isCancelledPending(row)
    );
    const migrations: RemovedRowMigration[] = [];
    for (const removed of removedList) {
        const removeMs = dayMs(removed.removeDate);
        const affected = policyVersions.filter((row) => {
            if (row.policy_change_end_date == null) {
                return false;
            }
            const startMs = dayMs(row.policy_change_start_date);
            const endMs = dayMs(row.policy_change_end_date);
            return (
                (endMs === removeMs && startMs < removeMs) ||
                (endMs === startMs && startMs >= removeMs)
            );
        });
        const audit = affected.reduce((latest, row) =>
            row.modified_at.getTime() > latest.modified_at.getTime() ? row : latest
        );
        const affectedIds = new Set(affected.map((row) => row.id));
        const reassignedAfter = policyVersions.some(
            (row) => row.id > removed.versionId && !affectedIds.has(row.id)
        );
        if (reassignedAfter) {
            migrations.push({
                removed,
                restores: null,
                addRemovedRow: false,
                modifiedAt: audit.modified_at,
                modifiedBy: audit.modified_by,
            });
            continue;
        }
        const ordered = policyVersions
            .filter((row) => affectedIds.has(row.id) || !isVoided(row))
            .sort(byStartThenId);
        const restores: EndDateRestore[] = [];
        for (const row of affected) {
            const next = ordered[ordered.indexOf(row) + 1];
            const toEnd = next?.policy_change_start_date ?? null;
            if (
                (toEnd == null ? null : dayMs(toEnd)) !==
                dayMs(row.policy_change_end_date!)
            ) {
                restores.push({
                    versionId: row.id,
                    fromEnd: row.policy_change_end_date,
                    toEnd,
                });
            }
        }
        migrations.push({
            removed,
            restores,
            addRemovedRow: !hasRemovedRowFor(rows, removed),
            modifiedAt: audit.modified_at,
            modifiedBy: audit.modified_by,
        });
    }
    return migrations;
}

function hasRemovedRowFor(rows: VersionRow[], removed: RemovedVersion): boolean {
    return rows.some(
        (row) =>
            isRemovedRowShape(row) &&
            row.id > removed.versionId &&
            dayMs(row.policy_change_start_date) === dayMs(removed.removeDate)
    );
}

function earliest(dates: Date[]): Date {
    return new Date(Math.min(...dates.map(dayMs)));
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
        const today = startOfTodayUtc();
        const rows = await loadCandidateVersions(prisma, args);
        const byCustomer = new Map<number, VersionRow[]>();
        for (const row of rows) {
            const bucket = byCustomer.get(row.customer_id) ?? [];
            bucket.push(row);
            byCustomer.set(row.customer_id, bucket);
        }

        const removedByAccount = new Map<number, RemovedVersion[]>();
        const migrationsByAccount = new Map<number, RemovedRowMigration[]>();
        for (const customerRows of byCustomer.values()) {
            const accountId = customerRows[0]!.account_id;
            const removedList = findRemovedVersions(customerRows, dayMs(today));
            for (const removed of removedList) {
                const bucket = removedByAccount.get(removed.accountId) ?? [];
                bucket.push(removed);
                removedByAccount.set(removed.accountId, bucket);
            }
            const migrations = planRemovedRowMigrations(
                customerRows,
                removedList
            ).filter(
                (migration) =>
                    migration.restores == null ||
                    migration.restores.length > 0 ||
                    migration.addRemovedRow
            );
            if (migrations.length > 0) {
                migrationsByAccount.set(accountId, [
                    ...(migrationsByAccount.get(accountId) ?? []),
                    ...migrations,
                ]);
            }
        }
        const blockers = await loadAccountSnapshotLeaseBlockers(
            [...removedByAccount.keys()],
            prisma
        );

        const totalRemoved = [...removedByAccount.values()].reduce(
            (sum, list) => sum + list.length,
            0
        );
        console.log(`${LOG} plan`, {
            accounts: removedByAccount.size,
            removedVersions: totalRemoved,
            blockedAccounts: blockers.size,
            today: ymd(today),
        });
        for (const [accountId, removedList] of removedByAccount) {
            const blocker = blockers.get(accountId);
            console.log(
                `${LOG} account ${accountId}${
                    blocker
                        ? ` (skipped: ${blocker.jobKind} job ${blocker.status})`
                        : ""
                }`
            );
            for (const r of removedList) {
                console.log(
                    `    customer ${r.customerId}${r.linkedChild ? " (linked child)" : ""} version ${r.versionId}: policy ${r.policyId} ${r.policyNumber ?? ""} removed ${ymd(r.removeDate)}, ${daysThrough(r.removeDate, today)} day(s) through today`
                );
            }
            for (const m of migrationsByAccount.get(accountId) ?? []) {
                if (m.restores == null) {
                    console.log(
                        `      customer ${m.removed.customerId}: assigned again after the remove; old end dates kept`
                    );
                    continue;
                }
                for (const restore of m.restores) {
                    console.log(
                        `      customer ${m.removed.customerId} version ${restore.versionId}: end ${ymd(restore.fromEnd)} → ${ymd(restore.toEnd)}`
                    );
                }
                if (m.addRemovedRow) {
                    console.log(
                        `      customer ${m.removed.customerId}: add Removed row from ${ymd(m.removed.removeDate)} (modified ${m.modifiedAt.toISOString()})`
                    );
                }
            }
        }

        if (args.dryRun) {
            console.log(`${LOG} dry-run complete; no writes`);
            return;
        }

        let accountsFixed = 0;
        let removedRowsMigrated = 0;
        let policyRowsUpdated = 0;
        let failures = 0;
        for (const [accountId, removedList] of removedByAccount) {
            if (blockers.has(accountId)) {
                continue;
            }
            try {
                for (const m of migrationsByAccount.get(accountId) ?? []) {
                    if (m.restores == null) {
                        continue;
                    }
                    await prisma.$transaction(async (tx) => {
                        // Raw SQL: Prisma would bump @updatedAt modified_at.
                        for (const restore of m.restores!) {
                            await tx.$executeRaw`
                                UPDATE "CustomerPolicy"
                                SET policy_change_end_date = ${restore.toEnd}::date
                                WHERE id = ${restore.versionId}
                            `;
                        }
                        if (m.addRemovedRow) {
                            await tx.$executeRaw`
                                INSERT INTO "CustomerPolicy" (
                                    customer_id, insurance_policy_id,
                                    policy_change_start_date, status, is_active,
                                    created_at, modified_at, created_by, modified_by
                                ) VALUES (
                                    ${m.removed.customerId}, NULL,
                                    ${m.removed.removeDate}::date,
                                    'inactive'::customer_policy_status, FALSE,
                                    ${m.modifiedAt}, ${m.modifiedAt},
                                    ${m.modifiedBy}, ${m.modifiedBy}
                                )
                            `;
                        }
                    });
                    await stripInvoicePolicyStampsFromUnassignDay(
                        m.removed.customerId,
                        m.removed.policyId,
                        m.removed.removeDate,
                        { dbClient: prisma }
                    );
                    removedRowsMigrated += 1;
                }

                const removeDatesByPolicy = new Map<number, Date[]>();
                for (const r of removedList) {
                    const dates = removeDatesByPolicy.get(r.policyId) ?? [];
                    dates.push(r.removeDate);
                    removeDatesByPolicy.set(r.policyId, dates);
                }
                for (const [policyId, dates] of removeDatesByPolicy) {
                    const result = await rollUpInsurancePolicyTrendFromCustomerPolicyTrend(
                        {
                            accountId,
                            policyId,
                            fromDate: earliest(dates),
                            toDate: today,
                        },
                        { dbClient: prisma }
                    );
                    policyRowsUpdated += result.policyRowsUpdated;
                }

                const customerIds = new Set(removedList.map((r) => r.customerId));
                for (const customerId of [...customerIds]) {
                    const descendants = await listDescendantCustomerIds(
                        customerId,
                        accountId,
                        prisma
                    );
                    descendants.forEach((id) => customerIds.add(id));
                }
                const fromDate = earliest(removedList.map((r) => r.removeDate));
                await enqueueAsOfRewrite(
                    {
                        accountId,
                        customerIds: [...customerIds].sort((a, b) => a - b),
                        fromDate,
                        toDate: today,
                    },
                    prisma
                );
                accountsFixed += 1;
                console.log(`${LOG} account fixed`, {
                    accountId,
                    policies: [...removeDatesByPolicy.keys()],
                    enqueuedCustomers: customerIds.size,
                    fromDate: ymd(fromDate),
                    toDate: ymd(today),
                });
            } catch (error) {
                failures += 1;
                console.error(`${LOG} account failed`, {
                    accountId,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });
            }
        }

        console.log(`${LOG} fixed`, {
            accountsFixed,
            accountsSkipped: [...blockers.keys()],
            removedRowsMigrated,
            policyRowsUpdated,
            failures,
        });
        if (failures > 0) {
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
