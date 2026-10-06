/**
 * One-off datafix: copy missing child CustomerTopUp rows onto the top credit
 * pool shell for account 10149, then cancel matching live child rows.
 *
 * D12 match: insurance_policy_id + start_date + end_date + type + amount +
 * currency (cancelled_at ignored). Copies include cancelled history as-is.
 * Bypasses createTopUp overlap checks (D14).
 *
 * Usage:
 *   npx tsx scripts/datafixes/lift-child-topups-to-shell-10149.ts
 *   npx tsx scripts/datafixes/lift-child-topups-to-shell-10149.ts --apply
 *
 * Default is dry-run. Does not log secrets or connection strings.
 */
import "dotenv/config";
import { Prisma, PrismaClient, type CustomerTopUp } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    listDescendantCustomerIds,
    resolveCustomerCreditPoolRoot,
    startCreditAsOfBackfillJob,
    startOfTodayUtc,
} from "@archaser/credit-insurance-domain";

const LOG = "[lift-child-topups-to-shell-10149]";
const ACCOUNT_ID = 10149;

type TopUpRow = Pick<
    CustomerTopUp,
    | "id"
    | "customer_id"
    | "insurance_policy_id"
    | "top_up_type"
    | "top_up_value"
    | "currency"
    | "start_date"
    | "end_date"
    | "notes"
    | "premium"
    | "premium_currency"
    | "cancelled_at"
    | "created_by"
    | "modified_by"
>;

const TOP_UP_SELECT = {
    id: true,
    customer_id: true,
    insurance_policy_id: true,
    top_up_type: true,
    top_up_value: true,
    currency: true,
    start_date: true,
    end_date: true,
    notes: true,
    premium: true,
    premium_currency: true,
    cancelled_at: true,
    created_by: true,
    modified_by: true,
} as const;

function utcDayKey(value: Date): string {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

function d12Key(row: TopUpRow): string {
    const amount = new Prisma.Decimal(row.top_up_value).toFixed(4);
    const currency = row.currency == null ? "<null>" : row.currency;
    return [
        row.insurance_policy_id,
        utcDayKey(row.start_date),
        utcDayKey(row.end_date),
        row.top_up_type,
        amount,
        currency,
    ].join("|");
}

function summarizeRow(row: TopUpRow): Record<string, unknown> {
    return {
        id: row.id,
        customerId: row.customer_id,
        insurancePolicyId: row.insurance_policy_id,
        topUpType: row.top_up_type,
        topUpValue: new Prisma.Decimal(row.top_up_value).toFixed(4),
        currency: row.currency,
        startDate: utcDayKey(row.start_date),
        endDate: utcDayKey(row.end_date),
        cancelledAt: row.cancelled_at?.toISOString() ?? null,
    };
}

function minDate(values: Date[]): Date | null {
    if (values.length === 0) {
        return null;
    }
    let min = values[0];
    for (const value of values) {
        if (value.getTime() < min.getTime()) {
            min = value;
        }
    }
    return min;
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const dryRun = !apply;
    const prisma = new PrismaClient();
    bindCreditInsurancePrisma(prisma);

    console.log(LOG, {
        accountId: ACCOUNT_ID,
        mode: dryRun ? "dry-run" : "apply",
    });

    let copiedCount = 0;
    let skipCount = 0;
    let cancelCount = 0;
    const copiedStartDates: Date[] = [];

    try {
        const linkedChildren = await prisma.customer.findMany({
            where: {
                account_id: ACCOUNT_ID,
                parent_customer_id: { not: null },
            },
            select: { id: true },
        });

        const rootIds = new Set<number>();
        for (const child of linkedChildren) {
            const rootId = await resolveCustomerCreditPoolRoot(child.id, prisma);
            if (rootId === child.id) {
                continue;
            }
            rootIds.add(rootId);
        }

        const roots = await prisma.customer.findMany({
            where: { id: { in: [...rootIds] }, account_id: ACCOUNT_ID },
            select: { id: true, customer_number: true },
        });
        const rootById = new Map(roots.map((r) => [r.id, r]));

        for (const rootId of rootIds) {
            const root = rootById.get(rootId);
            const descendantIds = await listDescendantCustomerIds(
                rootId,
                ACCOUNT_ID,
                prisma
            );
            const poolIds = [rootId, ...descendantIds];
            const descendants = descendantIds.length
                ? await prisma.customer.findMany({
                      where: { id: { in: descendantIds } },
                      select: { id: true, customer_number: true },
                  })
                : [];
            const descendantNumberById = new Map(
                descendants.map((c) => [c.id, c.customer_number])
            );

            const allTopUps = await prisma.customerTopUp.findMany({
                where: { customer_id: { in: poolIds } },
                select: TOP_UP_SELECT,
            });
            const rootRows = allTopUps.filter((row) => row.customer_id === rootId);
            const descendantRows = allTopUps.filter(
                (row) => row.customer_id !== rootId
            );

            const rootKeys = new Set(rootRows.map(d12Key));
            const copyCandidates: TopUpRow[] = [];
            const skipAlreadyHas: TopUpRow[] = [];

            for (const row of descendantRows) {
                const key = d12Key(row);
                if (rootKeys.has(key)) {
                    skipAlreadyHas.push(row);
                    continue;
                }
                copyCandidates.push(row);
                rootKeys.add(key);
            }

            const wouldCancel = descendantRows.filter(
                (row) => rootKeys.has(d12Key(row)) && row.cancelled_at == null
            );
            const proposedFrom = minDate(copyCandidates.map((row) => row.start_date));

            console.log(LOG, "root", {
                rootCustomerId: rootId,
                rootCustomerNumber: root?.customer_number ?? null,
                descendantIds,
                descendantNumbers: descendantIds.map(
                    (id) => descendantNumberById.get(id) ?? null
                ),
                copyCandidateCount: copyCandidates.length,
                copyCandidates: copyCandidates.map(summarizeRow),
                skipAlreadyHasCount: skipAlreadyHas.length,
                skipAlreadyHas: skipAlreadyHas.map(summarizeRow),
                wouldCancelCount: wouldCancel.length,
                wouldCancelChildIds: wouldCancel.map((row) => row.id),
                proposedAsOfFrom: proposedFrom ? utcDayKey(proposedFrom) : null,
            });

            skipCount += skipAlreadyHas.length;
            cancelCount += wouldCancel.length;

            if (dryRun) {
                copiedCount += copyCandidates.length;
                if (proposedFrom) {
                    copiedStartDates.push(proposedFrom);
                }
                continue;
            }

            await prisma.$transaction(async (tx) => {
                for (const row of copyCandidates) {
                    await tx.customerTopUp.create({
                        data: {
                            customer_id: rootId,
                            insurance_policy_id: row.insurance_policy_id,
                            top_up_type: row.top_up_type,
                            top_up_value: row.top_up_value,
                            currency: row.currency,
                            start_date: row.start_date,
                            end_date: row.end_date,
                            notes: row.notes,
                            premium: row.premium,
                            premium_currency: row.premium_currency,
                            cancelled_at: row.cancelled_at,
                            created_by: row.created_by,
                            modified_by: row.modified_by,
                        },
                    });
                }

                if (wouldCancel.length > 0) {
                    await tx.customerTopUp.updateMany({
                        where: {
                            id: { in: wouldCancel.map((row) => row.id) },
                            cancelled_at: null,
                        },
                        data: { cancelled_at: new Date() },
                    });
                }
            });

            copiedCount += copyCandidates.length;
            if (proposedFrom) {
                copiedStartDates.push(proposedFrom);
            }
        }

        const globalFrom = minDate(copiedStartDates);
        const toDate = startOfTodayUtc();
        const proposedAsOfFrom = globalFrom ? utcDayKey(globalFrom) : null;

        console.log(LOG, "summary", {
            mode: dryRun ? "dry-run" : "apply",
            roots: rootIds.size,
            linkedChildren: linkedChildren.length,
            copyCount: copiedCount,
            skipAlreadyHasCount: skipCount,
            cancelCount,
            proposedAsOfFrom,
            proposedAsOfTo: utcDayKey(toDate),
        });

        if (dryRun) {
            return;
        }

        if (copiedCount === 0 || globalFrom == null) {
            console.log(LOG, "skip as-of enqueue — nothing copied");
            return;
        }

        const status = await startCreditAsOfBackfillJob(
            ACCOUNT_ID,
            globalFrom,
            toDate,
            {
                requestedBy: "lift-child-topups-to-shell-10149",
                dbClient: prisma,
            }
        );
        console.log(LOG, "enqueued as-of backfill", {
            accountId: ACCOUNT_ID,
            fromDate: utcDayKey(globalFrom),
            toDate: utcDayKey(toDate),
            status: status.status,
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
