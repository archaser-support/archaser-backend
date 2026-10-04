/**
 * Staging datafix: create shell parents for the full customer-group list,
 * copy active policy from the main customer (or another ID on the row), force
 * Named, link children via onParentCustomerIdChanged, then drain CTP history
 * for each shell pool.
 *
 * Account: 10149. Shell customer_number starts at 1000 (bumps if taken).
 * Existing shells are reused: children are (re)linked and CTP history still runs.
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
    getCreditPoolParentHistoryJobStatus,
    onParentCustomerIdChanged,
    remirrorDescendantsFromRoot,
    resolveCreditPoolMemberIds,
    resolveCustomerCreditPoolRoot,
    runCreditPoolParentHistoryJob,
    startCreditPoolParentHistoryJob,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";

const LOG = "[create-shell-from-group-list]";
const ACCOUNT_ID = 10149;
const START_SHELL_NUMBER = 1000;
const PARENT_HISTORY_JOB_KIND = "credit_pool_parent_history";

type GroupRow = {
    name: string;
    mainCustomerNumber: string;
    otherCustomerNumbers: string[];
};

/** Full screenshot list (all customer groups). */
const ROWS: GroupRow[] = [
    {
        name: 'א.ל.מ סחר 0 2 בע"מ ח.פ. 511021495',
        mainCustomerNumber: "107821693",
        otherCustomerNumbers: ["107821686"],
    },
    {
        name: 'אספירקום מערכות בע"מ',
        mainCustomerNumber: "10783466",
        otherCustomerNumbers: ["107926914"],
    },
    {
        name: 'היי ביז בע"מ',
        mainCustomerNumber: "10726123",
        otherCustomerNumbers: ["107936626", "107911232"],
    },
    {
        name: 'פטקום אלקטריק בע"מ',
        mainCustomerNumber: "107134486",
        otherCustomerNumbers: ["10760077"],
    },
    {
        name: "אוטופון תקשורת",
        mainCustomerNumber: "107165472",
        otherCustomerNumbers: ["107933273"],
    },
    {
        name: "ווידיגאיט",
        mainCustomerNumber: "10784030",
        otherCustomerNumbers: ["107926601"],
    },
    {
        name: "איי.די טאצ",
        mainCustomerNumber: "107887603",
        otherCustomerNumbers: ["107926119", "107932986"],
    },
    {
        name: 'ת.ש פרו סלולר בע"מ',
        mainCustomerNumber: "107898084",
        otherCustomerNumbers: ["107902663"],
    },
    {
        name: "א.כ אינפיניטק בעמ",
        mainCustomerNumber: "107904928",
        otherCustomerNumbers: ["107902693"],
    },
    {
        name: "אוטופון תקשורת (חיפה)",
        mainCustomerNumber: "107165474",
        otherCustomerNumbers: ["107936575"],
    },
    {
        name: 'אלקטרה קמעונאות בע"מ',
        mainCustomerNumber: "107789795",
        otherCustomerNumbers: ["107789755"],
    },
    {
        name: 'אייסל ג.מ.א בע"מ',
        mainCustomerNumber: "10782790",
        otherCustomerNumbers: ["107122538", "10780429"],
    },
    {
        name: 'לאסט פרייס בע"מ',
        mainCustomerNumber: "107892115",
        otherCustomerNumbers: ["107796878"],
    },
    {
        name: 'סער טכנולוגיות (ז.ח) בע"מ',
        mainCustomerNumber: "107133527",
        otherCustomerNumbers: ["107940449"],
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

async function releaseBlockingParentHistoryJob(
    prisma: PrismaClient
): Promise<void> {
    await prisma.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'complete',
            last_error = ${"Cleared before shell create / CTP history"},
            updated_at = ${new Date()}
        WHERE account_id = ${ACCOUNT_ID}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status IN ('running', 'paused', 'syncing')
    `;
}

async function waitForParentHistoryIdle(prisma: PrismaClient): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const status = await getCreditPoolParentHistoryJobStatus(ACCOUNT_ID, {
            dbClient: prisma,
        });
        if (
            status.status !== "running" &&
            status.status !== "paused" &&
            status.status !== "syncing"
        ) {
            return;
        }
        console.log(LOG, "clearing blocking parent-history job", {
            status: status.status,
            daysDone: status.daysDone,
            daysTotal: status.daysTotal,
        });
        await releaseBlockingParentHistoryJob(prisma);
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

/** Drain scoped CTP history for one shell pool (awaits completion). */
async function drainShellCtpHistory(
    prisma: PrismaClient,
    shellId: number,
    shellCustomerNumber: string | null
): Promise<void> {
    await waitForParentHistoryIdle(prisma);

    const { memberIds } = await resolveCreditPoolMemberIds(
        shellId,
        ACCOUNT_ID,
        prisma
    );
    const fromDate =
        (await earliestArDate(prisma, memberIds)) ?? startOfTodayUtc();
    const toDate = startOfTodayUtc();
    const beforeCount = await prisma.customerPolicyTrend.count({
        where: { customer_id: shellId },
    });

    console.log(LOG, "starting CTP history", {
        shellCustomerNumber,
        shellCustomerId: shellId,
        memberCount: memberIds.length,
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        trendRowsBefore: beforeCount,
    });

    await startCreditPoolParentHistoryJob({
        accountId: ACCOUNT_ID,
        customerIds: memberIds,
        fromDate,
        toDate,
        dbClient: prisma,
    });

    // Keep the process alive and drive the runner if the fire-and-forget exits.
    for (;;) {
        const status = await getCreditPoolParentHistoryJobStatus(ACCOUNT_ID, {
            dbClient: prisma,
        });
        console.log(LOG, "CTP history progress", {
            shellCustomerNumber,
            status: status.status,
            daysDone: status.daysDone,
            daysTotal: status.daysTotal,
            lastError: status.lastError,
        });
        if (
            status.status === "complete" ||
            status.status === "failed" ||
            status.status === "paused"
        ) {
            const afterCount = await prisma.customerPolicyTrend.count({
                where: { customer_id: shellId },
            });
            console.log(LOG, "CTP history finished", {
                shellCustomerNumber,
                shellCustomerId: shellId,
                status: status.status,
                trendRowsAfter: afterCount,
                lastError: status.lastError,
            });
            if (status.status === "failed") {
                throw new Error(
                    `CTP history failed for shell ${shellCustomerNumber}: ${status.lastError}`
                );
            }
            return;
        }
        // Nudge runner if still marked running with no progress (payload in-process).
        if (status.status === "running" && status.daysDone === 0) {
            await runCreditPoolParentHistoryJob(ACCOUNT_ID, {
                dbClient: prisma,
            });
            continue;
        }
        await new Promise((r) => setTimeout(r, 10_000));
    }
}

async function linkChildrenToShell(args: {
    prisma: PrismaClient;
    shellId: number;
    children: Array<{
        id: number;
        customer_number: string | null;
        parent_customer_id: number | null;
    }>;
}): Promise<number> {
    const { prisma, shellId, children } = args;
    await assertParentIsShell(shellId, prisma);

    const previousParents = new Map<number, number | null>();
    let syncChildId: number | null = null;
    let syncPreviousParentId: number | null = null;
    let linked = 0;

    for (const child of children) {
        const previousParentId = child.parent_customer_id ?? null;
        previousParents.set(child.id, previousParentId);
        if (previousParentId === shellId) {
            continue;
        }
        await prisma.customer.update({
            where: { id: child.id },
            data: { parent_customer_id: shellId },
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
            nextParentId: shellId,
            dbClient: prisma,
        });

        const remirrored = new Set(parentChange.remirroredRoots);
        for (const previousParentId of previousParents.values()) {
            if (previousParentId == null || previousParentId === shellId) {
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

        // Do not cancel async history here — drainShellCtpHistory runs next and
        // owns the parent-history job for the full AR window.
        if (parentChange.asyncHistoryJob != null) {
            await releaseBlockingParentHistoryJob(prisma);
        }
    }

    return linked;
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const dryRun = !apply;

    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    let nextShellNumber = START_SHELL_NUMBER;
    let created = 0;
    let reused = 0;
    let skipped = 0;
    let linked = 0;
    let ctpDrained = 0;

    console.log(LOG, {
        accountId: ACCOUNT_ID,
        mode: dryRun ? "dry-run" : "apply",
        rows: ROWS.length,
        startShellNumber: START_SHELL_NUMBER,
        runCtpHistory: true,
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
            const children = numbers.map((n) => byNumber.get(n)!);
            let existingShell = await findExistingShellByCompanyName(
                prisma,
                companyName
            );

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

            if (!existingShell && (!activePolicy || policySourceCustomerNumber == null)) {
                skipped += 1;
                console.log(LOG, "skip row — no active policy on any row customer", {
                    name: row.name,
                    customerNumbers: numbers,
                });
                continue;
            }

            if (existingShell) {
                console.log(LOG, dryRun ? "would reuse shell" : "reusing shell", {
                    companyName,
                    shellCustomerId: existingShell.id,
                    shellCustomerNumber: existingShell.customer_number,
                    linkCustomerNumbers: numbers,
                });
                if (dryRun) {
                    reused += 1;
                    linked += children.length;
                    ctpDrained += 1;
                    continue;
                }

                linked += await linkChildrenToShell({
                    prisma,
                    shellId: existingShell.id,
                    children,
                });
                await drainShellCtpHistory(
                    prisma,
                    existingShell.id,
                    existingShell.customer_number
                );
                reused += 1;
                ctpDrained += 1;
                continue;
            }

            const allocated = await allocateShellNumber(prisma, nextShellNumber);
            nextShellNumber = allocated.nextPreferred;

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
                insurancePolicyId: activePolicy!.insurance_policy_id,
                customerNumberPolicy: activePolicy!.customer_number_policy,
                sourceLimitType: activePolicy!.limit_type,
                forcedLimitType: "Named",
                countryId: main.country_id,
                businessUnitId: main.business_unit_id,
                language: main.language,
                ownerId: main.owner_id,
            });

            if (dryRun) {
                created += 1;
                linked += children.length;
                ctpDrained += 1;
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
                    ...buildShellPolicyCreateData(activePolicy!),
                    customer_id: shell.id,
                } as never,
            });

            linked += await linkChildrenToShell({
                prisma,
                shellId: shell.id,
                children,
            });

            await drainShellCtpHistory(prisma, shell.id, allocated.number);

            created += 1;
            ctpDrained += 1;
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
            reusedOrWouldReuse: reused,
            skipped,
            linkedOrWouldLink: linked,
            ctpDrainedOrWouldDrain: ctpDrained,
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
