/**
 * Staging datafix: create shell parents for customer-group rows, copy active
 * policy from the main customer (or another ID on the same row), force Named,
 * then link all row IDs as children via onParentCustomerIdChanged.
 *
 * Account: 10149. Shell customer_number starts at 1002 (bumps if taken).
 *
 * Usage:
 *   npx tsx scripts/datafixes/create-shell-customers-from-group-list.ts
 *   npx tsx scripts/datafixes/create-shell-customers-from-group-list.ts --apply
 *
 * Default is dry-run. Does not log secrets or connection strings.
 */
import "dotenv/config";
import { PrismaClient, type CustomerPolicy } from "@prisma/client";
import {
    assertParentIsShell,
    bindCreditInsurancePrisma,
    onParentCustomerIdChanged,
    remirrorDescendantsFromRoot,
    resolveCustomerCreditPoolRoot,
} from "@archaser/credit-insurance-domain";

const LOG = "[create-shell-from-group-list]";
const ACCOUNT_ID = 10149;
const START_SHELL_NUMBER = 1002;
const PARENT_HISTORY_JOB_KIND = "credit_pool_parent_history";

type GroupRow = {
    name: string;
    mainCustomerNumber: string;
    otherCustomerNumbers: string[];
};

/**
 * Retry set: rows that failed on the first apply (missing IDs or no policy on main).
 * Policy source: main customer first, then other IDs on the same row.
 */
const ROWS: GroupRow[] = [
    {
        name: 'א.ל.מ סחר 0 2 בע"מ ח.פ. 511021495',
        mainCustomerNumber: "107821693",
        otherCustomerNumbers: ["107821686"],
    },
    {
        name: 'פטקום אלקטריק בע"מ',
        mainCustomerNumber: "107134486",
        otherCustomerNumbers: ["10760077"],
    },
    {
        name: "א.כ אינפיניטק בעמ",
        mainCustomerNumber: "107904928",
        otherCustomerNumbers: ["107902693"],
    },
    {
        name: 'אלקטרה קמעונאות בע"מ',
        mainCustomerNumber: "107789795",
        otherCustomerNumbers: ["107789755"],
    },
    {
        name: 'לאסט פרייס בע"מ',
        mainCustomerNumber: "107892115",
        otherCustomerNumbers: ["107796878"],
    },
];

const MIRROR_POLICY_FIELD_KEYS = [
    "insurance_policy_id",
    "customer_number_policy",
    "approved_limit",
    "approved_limit_currency",
    "approved_limit_expiration_date",
    "zero_limit_date",
    "limit_type",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "mep_cutoff_day",
    "mep_substitute_extra_days",
    "reporting_cutoff_day",
    "reporting_substitute_extra_days",
    "payment_term_cutoff_day",
    "payment_term_substitute_day",
    "excluded_from_policy",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "active_customer_since",
    "outdated_dcl",
    "cost_percent",
    "registration_fee_percent",
    "policy_change_start_date",
    "capacity_gap_amount",
    "capacity_gap_amount_date",
    "retained_capacity_gap",
    "uninsured_amount",
    "capacity_gap_amount1",
    "capacity_gap_currency1",
    "capacity_gap_amount2",
    "capacity_gap_currency2",
    "uninsured_amount1",
    "uninsured_currency1",
    "uninsured_amount2",
    "uninsured_currency2",
] as const;

function shellCompanyName(name: string): string {
    return `${name} (מאוחד)`;
}

function allNumbersOnRow(row: GroupRow): string[] {
    return [row.mainCustomerNumber, ...row.otherCustomerNumbers];
}

function buildShellPolicyCreateData(source: CustomerPolicy): Record<string, unknown> {
    const data: Record<string, unknown> = {
        status: "active",
        is_active: true,
        limit_type: "Named",
    };
    for (const key of MIRROR_POLICY_FIELD_KEYS) {
        if (key === "limit_type") {
            continue;
        }
        data[key] = source[key];
    }
    return data;
}

async function allocateShellNumber(
    prisma: PrismaClient,
    preferred: number
): Promise<{ number: string; nextPreferred: number }> {
    let n = preferred;
    for (;;) {
        const asString = String(n);
        const existing = await prisma.customer.findFirst({
            where: {
                account_id: ACCOUNT_ID,
                customer_number: asString,
            },
            select: { id: true },
        });
        if (!existing) {
            return { number: asString, nextPreferred: n + 1 };
        }
        n += 1;
    }
}

async function getParentHistoryJobStatus(
    prisma: PrismaClient
): Promise<{ status: string; units_done: number; units_total: number | null } | null> {
    const rows = await prisma.$queryRaw<
        Array<{ status: string; units_done: number; units_total: number | null }>
    >`
        SELECT status, units_done, units_total
        FROM "AccountBackgroundJob"
        WHERE account_id = ${ACCOUNT_ID}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

/** Mark parent-history job complete so the next row is not blocked. */
async function releaseParentHistoryJob(prisma: PrismaClient): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'complete',
            units_done = GREATEST(units_done, COALESCE(units_total, units_done)),
            last_error = ${"Skipped full CTP history drain for bulk shell create script"},
            updated_at = ${new Date()}
        WHERE account_id = ${ACCOUNT_ID}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status IN ('running', 'paused', 'syncing')
    `;
}

/** Block until parent-history job is not syncing/running/paused. Clears orphaned jobs. */
async function waitForParentHistoryIdle(prisma: PrismaClient): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const job = await getParentHistoryJobStatus(prisma);
        if (
            job == null ||
            (job.status !== "running" &&
                job.status !== "paused" &&
                job.status !== "syncing")
        ) {
            return;
        }

        console.log(LOG, "releasing blocking parent-history job", {
            status: job.status,
            unitsDone: job.units_done,
            unitsTotal: job.units_total,
        });
        await releaseParentHistoryJob(prisma);
    }

    const still = await getParentHistoryJobStatus(prisma);
    if (
        still &&
        (still.status === "running" ||
            still.status === "paused" ||
            still.status === "syncing")
    ) {
        throw new Error(
            `parent-history job still ${still.status} after release attempts`
        );
    }
}

async function findExistingShellByCompanyName(
    prisma: PrismaClient,
    companyName: string
): Promise<{ id: number; customer_number: string | null } | null> {
    const company = await prisma.company.findFirst({
        where: { name: companyName },
        select: { id: true },
        orderBy: { id: "desc" },
    });
    if (!company) {
        return null;
    }
    return prisma.customer.findFirst({
        where: {
            account_id: ACCOUNT_ID,
            company_id: company.id,
        },
        select: { id: true, customer_number: true },
        orderBy: { id: "desc" },
    });
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const dryRun = !apply;

    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    let nextShellNumber = START_SHELL_NUMBER;
    let created = 0;
    let skipped = 0;
    let linked = 0;

    console.log(LOG, {
        accountId: ACCOUNT_ID,
        mode: dryRun ? "dry-run" : "apply",
        rows: ROWS.length,
        startShellNumber: START_SHELL_NUMBER,
    });

    try {
        if (!dryRun) {
            await waitForParentHistoryIdle(prisma);
        }

        for (const row of ROWS) {
            const numbers = allNumbersOnRow(row);
            const found = await prisma.customer.findMany({
                where: {
                    account_id: ACCOUNT_ID,
                    customer_number: { in: numbers },
                },
                select: {
                    id: true,
                    customer_number: true,
                    country_id: true,
                    business_unit_id: true,
                    language: true,
                    owner_id: true,
                    parent_customer_id: true,
                },
            });
            const byNumber = new Map(
                found.map((c) => [c.customer_number ?? "", c])
            );
            const missing = numbers.filter((n) => !byNumber.has(n));
            if (missing.length > 0) {
                skipped += 1;
                console.log(LOG, "skip row — missing customer_number", {
                    name: row.name,
                    missing,
                });
                continue;
            }

            const main = byNumber.get(row.mainCustomerNumber)!;
            const companyName = shellCompanyName(row.name);
            const existingShell = await findExistingShellByCompanyName(
                prisma,
                companyName
            );
            if (existingShell) {
                skipped += 1;
                console.log(LOG, "skip row — shell already exists", {
                    name: row.name,
                    companyName,
                    shellCustomerId: existingShell.id,
                    shellCustomerNumber: existingShell.customer_number,
                });
                continue;
            }

            let activePolicy: CustomerPolicy | null = null;
            let policySourceCustomerNumber: string | null = null;
            for (const customerNumber of numbers) {
                const candidate = byNumber.get(customerNumber)!;
                const policy = await prisma.customerPolicy.findFirst({
                    where: {
                        customer_id: candidate.id,
                        is_active: true,
                    },
                });
                if (policy) {
                    activePolicy = policy;
                    policySourceCustomerNumber = customerNumber;
                    break;
                }
            }
            if (!activePolicy || policySourceCustomerNumber == null) {
                skipped += 1;
                console.log(LOG, "skip row — no active policy on any row customer", {
                    name: row.name,
                    customerNumbers: numbers,
                });
                continue;
            }

            const allocated = await allocateShellNumber(prisma, nextShellNumber);
            nextShellNumber = allocated.nextPreferred;
            const children = numbers.map((n) => byNumber.get(n)!);

            console.log(LOG, dryRun ? "would process row" : "processing row", {
                shellCustomerNumber: allocated.number,
                companyName,
                mainCustomerNumber: row.mainCustomerNumber,
                mainCustomerId: main.id,
                policySourceCustomerNumber,
                linkCustomerIds: children.map((c) => c.id),
                linkCustomerNumbers: numbers,
                currentParents: children.map((c) => ({
                    customerNumber: c.customer_number,
                    parentCustomerId: c.parent_customer_id,
                })),
                insurancePolicyId: activePolicy.insurance_policy_id,
                customerNumberPolicy: activePolicy.customer_number_policy,
                sourceLimitType: activePolicy.limit_type,
                forcedLimitType: "Named",
                countryId: main.country_id,
                businessUnitId: main.business_unit_id,
                language: main.language,
                ownerId: main.owner_id,
            });

            if (dryRun) {
                created += 1;
                linked += children.length;
                continue;
            }

            await waitForParentHistoryIdle(prisma);

            const company = await prisma.company.create({
                data: {
                    name: companyName,
                    company_number: `SHELL-${allocated.number}`,
                },
            });

            const shell = await prisma.customer.create({
                data: {
                    account_id: ACCOUNT_ID,
                    type: "Company",
                    company_id: company.id,
                    customer_number: allocated.number,
                    collection_status: "Inactive",
                    country_id: main.country_id,
                    business_unit_id: main.business_unit_id,
                    language: main.language,
                    owner_id: main.owner_id,
                },
            });

            await prisma.customerPolicy.create({
                data: {
                    ...buildShellPolicyCreateData(activePolicy),
                    customer_id: shell.id,
                } as never,
            });

            await assertParentIsShell(shell.id, prisma);

            // Set all parent FKs first, then one product sync so history runs once.
            const previousParents = new Map<number, number | null>();
            let syncChildId: number | null = null;
            let syncPreviousParentId: number | null = null;
            for (const child of children) {
                const previousParentId = child.parent_customer_id ?? null;
                previousParents.set(child.id, previousParentId);
                if (previousParentId === shell.id) {
                    continue;
                }
                await prisma.customer.update({
                    where: { id: child.id },
                    data: { parent_customer_id: shell.id },
                });
                if (syncChildId == null) {
                    syncChildId = child.id;
                    syncPreviousParentId = previousParentId;
                }
                linked += 1;
            }

            if (syncChildId != null) {
                await waitForParentHistoryIdle(prisma);
                const parentChange = await onParentCustomerIdChanged({
                    accountId: ACCOUNT_ID,
                    customerId: syncChildId,
                    previousParentId: syncPreviousParentId,
                    nextParentId: shell.id,
                    dbClient: prisma,
                });

                // Remirror any other former parents that lost a child.
                const remirrored = new Set(parentChange.remirroredRoots);
                for (const previousParentId of previousParents.values()) {
                    if (previousParentId == null || previousParentId === shell.id) {
                        continue;
                    }
                    const oldRootId = await resolveCustomerCreditPoolRoot(
                        previousParentId,
                        prisma
                    );
                    if (remirrored.has(oldRootId)) {
                        continue;
                    }
                    await remirrorDescendantsFromRoot(oldRootId, ACCOUNT_ID, {
                        dbClient: prisma,
                    });
                    remirrored.add(oldRootId);
                }

                if (parentChange.asyncHistoryJob != null) {
                    console.log(
                        LOG,
                        "releasing parent-history job (skip full CTP history drain)"
                    );
                    await releaseParentHistoryJob(prisma);
                }
            }

            created += 1;
            console.log(LOG, "created shell", {
                shellCustomerId: shell.id,
                shellCustomerNumber: allocated.number,
                companyId: company.id,
                companyName,
            });
        }

        console.log(LOG, "done", {
            mode: dryRun ? "dry-run" : "apply",
            createdOrWouldCreate: created,
            skipped,
            linkedOrWouldLink: linked,
            nextFreeShellNumber: nextShellNumber,
        });
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
