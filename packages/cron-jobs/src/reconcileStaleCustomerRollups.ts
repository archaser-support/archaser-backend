import { Prisma, type PrismaClient } from "@prisma/client";

import type { CronFrozenAccountGuard } from "./accountFreeze/cronFrozenAccountGuard";
import { recalculateCustomerAmountsViaApi } from "./customersDomain";
import { jobLog } from "./logging/jobLog";

/** Max customers recalculated per cron run (safety net, not full backfill). */
export const RECONCILE_STALE_ROLLUPS_BATCH_SIZE = 200;

const LOG_SOURCE = "reconcile-stale-rollups";

export type StaleRollupMismatch = {
    customerId: number;
    accountId: number;
    rollupOverdue: number;
    rollupDue: number;
    liveOverdue: number;
    liveDue: number;
};

export type FindStaleRollupMismatchesOptions = {
    limit: number;
    excludeAccountIds?: ReadonlySet<number>;
    /** When set, only these accounts (e.g. frozen-skip reporting). */
    onlyAccountIds?: ReadonlySet<number> | number[];
    accountId?: number;
    customerIds?: number[];
    /**
     * Sep 17 incident pattern: denormalized overdue count > 0 while live
     * Overdue invoice count is 0 (Paid/virtual-close left rollups stale).
     */
    fullyStaleOverdueOnly?: boolean;
};

type MismatchSqlRow = {
    customer_id: number;
    account_id: number;
    rollup_overdue: number;
    rollup_due: number;
    live_overdue: number;
    live_due: number;
};

type AccountScopeFilters = {
    frozenFilter: Prisma.Sql;
    onlyAccountsFilter: Prisma.Sql;
    accountFilter: Prisma.Sql;
    customerFilter: Prisma.Sql;
};

function buildAccountScopeFilters(
    options: FindStaleRollupMismatchesOptions
): AccountScopeFilters {
    const exclude = [...(options.excludeAccountIds ?? [])].filter(
        (id) => Number.isFinite(id) && id > 0
    );
    const onlyAccounts = [...(options.onlyAccountIds ?? [])].filter(
        (id) => Number.isFinite(id) && id > 0
    );
    const customerIds = (options.customerIds ?? []).filter(
        (id) => Number.isFinite(id) && id > 0
    );

    return {
        frozenFilter:
            exclude.length > 0
                ? Prisma.sql`AND c.account_id NOT IN (${Prisma.join(exclude)})`
                : Prisma.empty,
        onlyAccountsFilter:
            onlyAccounts.length > 0
                ? Prisma.sql`AND c.account_id IN (${Prisma.join(onlyAccounts)})`
                : Prisma.empty,
        accountFilter:
            options.accountId != null &&
            Number.isFinite(options.accountId) &&
            options.accountId > 0
                ? Prisma.sql`AND c.account_id = ${options.accountId}`
                : Prisma.empty,
        customerFilter:
            customerIds.length > 0
                ? Prisma.sql`AND c.id IN (${Prisma.join(customerIds)})`
                : Prisma.empty,
    };
}

function mapMismatchRows(rows: MismatchSqlRow[]): StaleRollupMismatch[] {
    return rows.map((row) => ({
        customerId: row.customer_id,
        accountId: row.account_id,
        rollupOverdue: row.rollup_overdue,
        rollupDue: row.rollup_due,
        liveOverdue: row.live_overdue,
        liveDue: row.live_due,
    }));
}

/**
 * Pass 1 — customers with positive denormalized due/overdue counts whose live
 * Due/Overdue invoice counts disagree (covers the Sep 17 stale cohort).
 */
async function findPositiveRollupMismatches(
    prisma: PrismaClient,
    options: FindStaleRollupMismatchesOptions,
    scope: AccountScopeFilters
): Promise<StaleRollupMismatch[]> {
    const limit = Math.max(1, Math.floor(options.limit));
    const mismatchFilter = options.fullyStaleOverdueOnly
        ? Prisma.sql`AND COALESCE(live.overdue_count, 0) = 0`
        : Prisma.sql`AND (
            COALESCE(c.number_of_overdue_invoices, 0) <> COALESCE(live.overdue_count, 0)
            OR COALESCE(c.no_of_due_invoices, 0) <> COALESCE(live.due_count, 0)
          )`;
    const candidateFilter = options.fullyStaleOverdueOnly
        ? Prisma.sql`AND COALESCE(c.number_of_overdue_invoices, 0) > 0`
        : Prisma.sql`AND (
            COALESCE(c.number_of_overdue_invoices, 0) > 0
            OR COALESCE(c.no_of_due_invoices, 0) > 0
          )`;

    const rows = await prisma.$queryRaw<MismatchSqlRow[]>`
        SELECT
            c.id AS customer_id,
            c.account_id AS account_id,
            COALESCE(c.number_of_overdue_invoices, 0)::int AS rollup_overdue,
            COALESCE(c.no_of_due_invoices, 0)::int AS rollup_due,
            COALESCE(live.overdue_count, 0)::int AS live_overdue,
            COALESCE(live.due_count, 0)::int AS live_due
        FROM "Customer" c
        LEFT JOIN (
            SELECT
                customer_id,
                COUNT(*) FILTER (WHERE status = 'Overdue')::int AS overdue_count,
                COUNT(*) FILTER (WHERE status = 'Due')::int AS due_count
            FROM "Invoice"
            WHERE status IN ('Due', 'Overdue')
              AND customer_id IS NOT NULL
            GROUP BY customer_id
        ) live ON live.customer_id = c.id
        WHERE c.account_id IS NOT NULL
          ${candidateFilter}
          ${mismatchFilter}
          ${scope.frozenFilter}
          ${scope.onlyAccountsFilter}
          ${scope.accountFilter}
          ${scope.customerFilter}
        ORDER BY c.id ASC
        LIMIT ${limit}
    `;

    return mapMismatchRows(rows);
}

/**
 * Pass 2 — rollups say zero open due/overdue but live Due/Overdue invoices exist.
 * Skipped for fully-stale-overdue-only scans.
 */
async function findUndercountedRollupMismatches(
    prisma: PrismaClient,
    options: FindStaleRollupMismatchesOptions,
    scope: AccountScopeFilters,
    excludeCustomerIds: number[]
): Promise<StaleRollupMismatch[]> {
    const limit = Math.max(1, Math.floor(options.limit));
    if (limit <= 0) {
        return [];
    }
    const alreadyFoundFilter =
        excludeCustomerIds.length > 0
            ? Prisma.sql`AND c.id NOT IN (${Prisma.join(excludeCustomerIds)})`
            : Prisma.empty;

    const rows = await prisma.$queryRaw<MismatchSqlRow[]>`
        SELECT
            c.id AS customer_id,
            c.account_id AS account_id,
            COALESCE(c.number_of_overdue_invoices, 0)::int AS rollup_overdue,
            COALESCE(c.no_of_due_invoices, 0)::int AS rollup_due,
            COUNT(*) FILTER (WHERE i.status = 'Overdue')::int AS live_overdue,
            COUNT(*) FILTER (WHERE i.status = 'Due')::int AS live_due
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.status IN ('Due', 'Overdue')
          AND i.customer_id IS NOT NULL
          AND c.account_id IS NOT NULL
          AND COALESCE(c.number_of_overdue_invoices, 0) = 0
          AND COALESCE(c.no_of_due_invoices, 0) = 0
          ${alreadyFoundFilter}
          ${scope.frozenFilter}
          ${scope.onlyAccountsFilter}
          ${scope.accountFilter}
          ${scope.customerFilter}
        GROUP BY c.id, c.account_id, c.number_of_overdue_invoices, c.no_of_due_invoices
        HAVING
            COUNT(*) FILTER (WHERE i.status = 'Overdue') > 0
            OR COUNT(*) FILTER (WHERE i.status = 'Due') > 0
        ORDER BY c.id ASC
        LIMIT ${limit}
    `;

    return mapMismatchRows(rows);
}

/**
 * Customers whose denormalized due/overdue counts disagree with live
 * Due/Overdue invoice counts. Bounded by `limit`; does not log secrets.
 */
export async function findStaleRollupMismatches(
    prisma: PrismaClient,
    options: FindStaleRollupMismatchesOptions
): Promise<StaleRollupMismatch[]> {
    const limit = Math.max(1, Math.floor(options.limit));
    const scope = buildAccountScopeFilters(options);

    const positive = await findPositiveRollupMismatches(prisma, options, scope);
    if (options.fullyStaleOverdueOnly || positive.length >= limit) {
        return positive.slice(0, limit);
    }

    const remaining = limit - positive.length;
    const undercounted = await findUndercountedRollupMismatches(
        prisma,
        { ...options, limit: remaining },
        scope,
        positive.map((row) => row.customerId)
    );

    return [...positive, ...undercounted].slice(0, limit);
}

/**
 * Periodic safety net: find rollup vs live Due/Overdue count mismatches and
 * recalculate via the same host path as billing sync.
 */
export async function reconcileStaleCustomerRollups(
    prisma: PrismaClient,
    freeze?: CronFrozenAccountGuard,
    options?: { batchSize?: number }
): Promise<{
    success: boolean;
    message: string;
    summary: {
        mismatchesFound: number;
        customersRecalculated: number;
        batchSize: number;
        sampleCustomerIds: number[];
    };
    durationMs: number;
}> {
    const start = Date.now();
    const batchSize = Math.max(
        1,
        options?.batchSize ?? RECONCILE_STALE_ROLLUPS_BATCH_SIZE
    );

    const mismatches = await findStaleRollupMismatches(prisma, {
        limit: batchSize,
        excludeAccountIds: freeze?.frozenAccountIds,
    });

    const reportFrozenSkips = async () => {
        if (!freeze || freeze.frozenAccountIds.size === 0) {
            return;
        }
        const skipped = await findStaleRollupMismatches(prisma, {
            limit: Math.min(50, batchSize),
            onlyAccountIds: freeze.frozenAccountIds,
        });
        freeze.reportSkips(skipped.map((row) => row.accountId));
    };

    if (mismatches.length === 0) {
        await reportFrozenSkips();
        return {
            success: true,
            message: "No stale customer due/overdue rollup mismatches",
            summary: {
                mismatchesFound: 0,
                customersRecalculated: 0,
                batchSize,
                sampleCustomerIds: [],
            },
            durationMs: Date.now() - start,
        };
    }

    const customerIds = mismatches.map((row) => row.customerId);
    const sampleCustomerIds = customerIds.slice(0, 20);

    jobLog(LOG_SOURCE, "info", "Recalculating stale customer rollups", {
        mismatchesFound: mismatches.length,
        batchSize,
        sampleCustomerIds,
    });

    await recalculateCustomerAmountsViaApi(customerIds, prisma);
    await reportFrozenSkips();

    return {
        success: true,
        message: `Recalculated ${customerIds.length} customer(s) with stale due/overdue rollups`,
        summary: {
            mismatchesFound: mismatches.length,
            customersRecalculated: customerIds.length,
            batchSize,
            sampleCustomerIds,
        },
        durationMs: Date.now() - start,
    };
}
