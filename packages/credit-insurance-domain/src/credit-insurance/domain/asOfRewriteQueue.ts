import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../domain-db";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";

type PrismaClientLike = PrismaClient;
type RawCapableClient = {
    $queryRaw: PrismaClientLike["$queryRaw"];
    $executeRaw: PrismaClientLike["$executeRaw"];
};

/**
 * Nest copy of the frontend as-of rewrite queue core.
 *
 * This module is intentionally not scheduled. Until cutover, frontend's
 * Customer Policy Trend cron is the sole live drain owner. Disable that job
 * before enabling the Nest entrypoint; never run both schedulers.
 */
export const REWRITE_QUEUE_STALE_PROCESSING_MS = 60 * 60 * 1000;

export type RewriteRange = {
    /** Empty means the whole account. */
    customerIds: number[];
    fromDate: Date;
    toDate: Date;
};

function toDayStartUtc(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function nextUtcDay(date: Date): Date {
    const next = toDayStartUtc(date);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

export function resolveRewriteDrainStart(
    fromDate: Date,
    checkpointDate: Date | null | undefined
): Date {
    const from = toDayStartUtc(fromDate);
    if (!checkpointDate) {
        return from;
    }
    const resume = nextUtcDay(checkpointDate);
    return resume.getTime() < from.getTime() ? from : resume;
}

export function coalesceCheckpointDate(
    existingFromDate: Date,
    mergedFromDate: Date,
    existingCheckpoint: Date | null | undefined
): Date | null {
    if (
        toDayStartUtc(mergedFromDate).getTime() <
        toDayStartUtc(existingFromDate).getTime()
    ) {
        return null;
    }
    return existingCheckpoint ? toDayStartUtc(existingCheckpoint) : null;
}

export function isStaleProcessingUpdatedAt(
    updatedAt: Date,
    now: Date = new Date(),
    staleMs: number = REWRITE_QUEUE_STALE_PROCESSING_MS
): boolean {
    return now.getTime() - updatedAt.getTime() >= staleMs;
}

export function isAdminBackfillBlockingDrain(
    status: string | null | undefined
): boolean {
    return status === "running" || status === "paused";
}

function unionCustomerIds(a: number[], b: number[]): number[] {
    if (a.length === 0 || b.length === 0) {
        return [];
    }
    return Array.from(new Set([...a, ...b])).sort((x, y) => x - y);
}

export function mergeRewriteRange(
    existing: RewriteRange,
    incoming: RewriteRange
): RewriteRange {
    return {
        customerIds: unionCustomerIds(
            existing.customerIds,
            incoming.customerIds
        ),
        fromDate: toDayStartUtc(
            incoming.fromDate < existing.fromDate
                ? incoming.fromDate
                : existing.fromDate
        ),
        toDate: toDayStartUtc(
            incoming.toDate > existing.toDate
                ? incoming.toDate
                : existing.toDate
        ),
    };
}

function customerIdsSql(ids: number[]): Prisma.Sql {
    return ids.length === 0
        ? Prisma.sql`ARRAY[]::int[]`
        : Prisma.sql`ARRAY[${Prisma.join(ids)}]::int[]`;
}

type PendingRow = {
    id: bigint;
    from_date: Date;
    to_date: Date;
    customer_ids: number[];
    checkpoint_date: Date | null;
};

export type EnqueueAsOfRewriteInput = {
    accountId: number;
    customerIds?: number[];
    fromDate: Date;
    toDate: Date;
};

async function enqueueAsOfRewriteWithClient(
    client: RawCapableClient,
    input: EnqueueAsOfRewriteInput
): Promise<void> {
    const incoming: RewriteRange = {
        customerIds: (input.customerIds ?? []).filter(Number.isFinite),
        fromDate: toDayStartUtc(input.fromDate),
        toDate: toDayStartUtc(input.toDate),
    };
    if (incoming.toDate < incoming.fromDate) {
        return;
    }

    const existing = await client.$queryRaw<PendingRow[]>`
        SELECT id, from_date, to_date, customer_ids, checkpoint_date
        FROM "CreditAsOfRewriteQueue"
        WHERE account_id = ${input.accountId} AND status = 'pending'
        ORDER BY id ASC
        LIMIT 1
        FOR UPDATE
    `;

    if (existing.length === 0) {
        await client.$executeRaw`
            INSERT INTO "CreditAsOfRewriteQueue" (
                account_id, customer_ids, from_date, to_date, status
            ) VALUES (
                ${input.accountId},
                ${customerIdsSql(incoming.customerIds)},
                ${incoming.fromDate},
                ${incoming.toDate},
                'pending'
            )
        `;
        return;
    }

    const row = existing[0];
    const merged = mergeRewriteRange(
        {
            customerIds: row.customer_ids ?? [],
            fromDate: row.from_date,
            toDate: row.to_date,
        },
        incoming
    );
    const checkpoint = coalesceCheckpointDate(
        row.from_date,
        merged.fromDate,
        row.checkpoint_date
    );
    await client.$executeRaw`
        UPDATE "CreditAsOfRewriteQueue"
        SET customer_ids = ${customerIdsSql(merged.customerIds)},
            from_date = ${merged.fromDate},
            to_date = ${merged.toDate},
            checkpoint_date = ${checkpoint},
            updated_at = NOW()
        WHERE id = ${row.id}
    `;
}

export async function enqueueAsOfRewrite(
    input: EnqueueAsOfRewriteInput,
    dbClient: PrismaClientLike = prisma
): Promise<void> {
    await dbClient.$transaction((tx) =>
        enqueueAsOfRewriteWithClient(tx, input)
    );
}

export async function enqueueAsOfRewriteInTransaction(
    tx: RawCapableClient,
    input: EnqueueAsOfRewriteInput
): Promise<void> {
    await enqueueAsOfRewriteWithClient(tx, input);
}

export async function enqueueRewriteForImport(
    args: {
        accountId: number;
        importType: "Invoice" | "Payment";
        entityIds: number[];
        customerIds: number[];
    },
    dbClient: PrismaClientLike = prisma
): Promise<void> {
    const entityIds = args.entityIds.filter(Number.isFinite);
    if (entityIds.length === 0) {
        return;
    }

    let minDate: Date | null;
    if (args.importType === "Invoice") {
        const aggregate = await dbClient.invoice.aggregate({
            where: { id: { in: entityIds } },
            _min: { invoice_date: true },
        });
        minDate = aggregate._min.invoice_date;
    } else {
        const aggregate = await dbClient.invoicePayment.aggregate({
            where: { id: { in: entityIds } },
            _min: { payment_date: true },
        });
        minDate = aggregate._min.payment_date;
    }
    if (!minDate) {
        return;
    }

    await enqueueAsOfRewrite(
        {
            accountId: args.accountId,
            customerIds: args.customerIds,
            fromDate: minDate,
            toDate: startOfTodayUtc(),
        },
        dbClient
    );
}

function enumerateUtcDays(fromDate: Date, toDate: Date): Date[] {
    const days: Date[] = [];
    const cursor = toDayStartUtc(fromDate);
    const end = toDayStartUtc(toDate);
    let guard = 0;
    while (cursor.getTime() <= end.getTime() && guard < 4000) {
        days.push(new Date(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard += 1;
    }
    return days;
}

export type DrainAsOfRewriteResult = {
    itemsProcessed: number;
    daysRewritten: number;
    failures: number;
    skippedForBackfill: number;
};

type DrainWriters = {
    syncCustomerPolicyTrendSnapshotForAccount: (
        accountId: number,
        options: {
            snapshotDate: Date;
            customerIds?: number[];
            mepBreachStartDate?: Date | null;
        }
    ) => Promise<unknown>;
    takeCreditDashboardDailySnapshotsForAccount: (
        accountId: number,
        options: { snapshotDate: Date }
    ) => Promise<unknown>;
};

export async function drainAsOfRewriteQueue(options?: {
    maxItems?: number;
    dbClient?: PrismaClientLike;
    now?: Date;
    writers?: Partial<DrainWriters>;
}): Promise<DrainAsOfRewriteResult> {
    const db = options?.dbClient ?? prisma;
    const maxItems = options?.maxItems ?? 25;
    const now = options?.now ?? new Date();
    const staleBefore = new Date(
        now.getTime() - REWRITE_QUEUE_STALE_PROCESSING_MS
    );

    await db.$executeRaw`
        UPDATE "CreditAsOfRewriteQueue"
        SET status = 'pending', updated_at = ${now}
        WHERE status = 'processing'
          AND updated_at < ${staleBefore}
    `;

    const syncCpt =
        options?.writers?.syncCustomerPolicyTrendSnapshotForAccount ??
        (
            await import("./customerPolicyTrendService")
        ).syncCustomerPolicyTrendSnapshotForAccount;
    const takeDashboard =
        options?.writers?.takeCreditDashboardDailySnapshotsForAccount ??
        (
            await import("./creditDashboardSnapshotService")
        ).takeCreditDashboardDailySnapshotsForAccount;

    const pending = await db.$queryRaw<
        Array<PendingRow & { account_id: number }>
    >`
        SELECT id, account_id, from_date, to_date, customer_ids, checkpoint_date
        FROM "CreditAsOfRewriteQueue"
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ${maxItems}
    `;

    const blockingAccountIds = new Set<number>();
    if (pending.length > 0) {
        const accountIds = Array.from(
            new Set(pending.map((item) => item.account_id))
        );
        const blocking = await db.$queryRaw<Array<{ account_id: number }>>`
            SELECT account_id
            FROM "CreditAsOfBackfillJob"
            WHERE account_id IN (${Prisma.join(accountIds)})
              AND status IN ('running', 'paused')
        `;
        blocking.forEach((row) => blockingAccountIds.add(row.account_id));
    }

    let itemsProcessed = 0;
    let daysRewritten = 0;
    let failures = 0;
    let skippedForBackfill = 0;

    for (const item of pending) {
        if (blockingAccountIds.has(item.account_id)) {
            skippedForBackfill += 1;
            continue;
        }

        const claimed = await db.$executeRaw`
            UPDATE "CreditAsOfRewriteQueue"
            SET status = 'processing', updated_at = ${now}
            WHERE id = ${item.id} AND status = 'pending'
        `;
        if (claimed === 0) {
            continue;
        }

        try {
            const customerIds = (item.customer_ids ?? []).filter(
                Number.isFinite
            );
            const resumeFrom = resolveRewriteDrainStart(
                item.from_date,
                item.checkpoint_date
            );
            // One resolve per queue item — the whole replay run for this account.
            const mepBreachStartDate = await resolveMepBreachStartDate(
                item.account_id
            );
            for (const day of enumerateUtcDays(resumeFrom, item.to_date)) {
                await syncCpt(item.account_id, {
                    snapshotDate: day,
                    customerIds:
                        customerIds.length > 0 ? customerIds : undefined,
                    mepBreachStartDate,
                });
                await takeDashboard(item.account_id, { snapshotDate: day });
                await db.$executeRaw`
                    UPDATE "CreditAsOfRewriteQueue"
                    SET checkpoint_date = ${day}, updated_at = ${now}
                    WHERE id = ${item.id}
                `;
                daysRewritten += 1;
            }
            await db.$executeRaw`
                UPDATE "CreditAsOfRewriteQueue"
                SET status = 'done', updated_at = ${now}
                WHERE id = ${item.id}
            `;
            itemsProcessed += 1;
        } catch (error) {
            failures += 1;
            const message =
                error instanceof Error ? error.message : String(error);
            await db.$executeRaw`
                UPDATE "CreditAsOfRewriteQueue"
                SET status = 'pending',
                    attempts = attempts + 1,
                    last_error = ${message.slice(0, 1000)},
                    updated_at = ${now}
                WHERE id = ${item.id}
            `;
        }
    }

    return { itemsProcessed, daysRewritten, failures, skippedForBackfill };
}
