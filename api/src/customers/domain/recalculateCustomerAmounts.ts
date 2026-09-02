/**
 * Recomputes a customer's denormalized due/overdue rollups from live Invoice rows.
 *
 * Ported from the legacy `server/services/CustomerService.ts` (deleted in frontend
 * commit 2223f5e when the Next server tree was retired). The aggregate math is
 * reproduced verbatim; the legacy post-commit effects are intentionally not ported:
 *
 * - parent `CustomerAggregatedData` rollup — excluded by the checkpoint PRD (D5)
 * - collection-period *closure* — owned by `CollectionPeriodService`, which also
 *   wrote timeline activities. A checkpoint restore re-inserts collection periods
 *   exactly as saved, so closing one here would deviate from the restored baseline.
 * - dashboard cache invalidation / log service — no Nest equivalent exists.
 */
import { Prisma, PrismaClient, record_status } from "@prisma/client";

export type RecalcDbClient = PrismaClient | Prisma.TransactionClient;

/** Concurrent customer row writes after the set-based aggregates. */
export const BALANCE_WRITE_CONCURRENCY = 16;

/** Default progress tick interval while writing customer rollups. */
export const BALANCE_PROGRESS_EVERY = 10;

export type RecalculateCustomerAmountsOptions = {
    /** Parallel customer updates (default {@link BALANCE_WRITE_CONCURRENCY}). */
    concurrency?: number;
    /** Emit after each progressEvery completions and at the end. */
    onProgress?: (progress: {
        processed: number;
        total: number;
    }) => void;
    /** Min completions between onProgress calls (default {@link BALANCE_PROGRESS_EVERY}). */
    progressEvery?: number;
};

async function runWithConcurrency<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>
): Promise<void> {
    if (items.length === 0) {
        return;
    }
    let cursor = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const i = cursor++;
            if (i >= items.length) {
                return;
            }
            await fn(items[i]!);
        }
    }
    const workerCount = Math.min(Math.max(1, limit), items.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export type CustomerDueAmounts = {
    total_due_amount: number;
    no_of_due_invoices: number;
    customer_due_amount1: number;
    customer_due_currency1: string | null;
    customer_due_amount2: number;
    customer_due_currency2: string | null;
};

export type CustomerOverdueAmounts = {
    total_outstanding_amount: number;
    no_of_overdue_invoices: number;
    customer_currency1: string | null;
    customer_outstanding_amount1: number;
    customer_currency2: string | null;
    customer_outstanding_amount2: number;
};

export type CustomerAmountsResult = {
    due: CustomerDueAmounts;
    overdue: CustomerOverdueAmounts;
};

const EMPTY_DUE: CustomerDueAmounts = {
    total_due_amount: 0,
    no_of_due_invoices: 0,
    customer_due_amount1: 0,
    customer_due_currency1: null,
    customer_due_amount2: 0,
    customer_due_currency2: null,
};

const EMPTY_OVERDUE: CustomerOverdueAmounts = {
    total_outstanding_amount: 0,
    no_of_overdue_invoices: 0,
    customer_currency1: null,
    customer_outstanding_amount1: 0,
    customer_currency2: null,
    customer_outstanding_amount2: 0,
};

/**
 * Due totals per customer. Invoices with a zero balance on both the account and
 * customer currency columns are excluded; credits (negative amounts) are kept.
 */
export async function calculateDueAmountsForCustomers(
    customerIds: number[],
    db: RecalcDbClient
): Promise<Map<number, CustomerDueAmounts>> {
    const result = new Map<number, CustomerDueAmounts>();
    if (!customerIds.length) {
        return result;
    }

    const nonZeroBalance = {
        customer_id: { in: customerIds },
        status: "Due" as const,
        OR: [
            { outstanding_debt: { not: 0 } },
            { customer_outstanding_debt: { not: 0 } },
        ],
    };

    const [totalGrouped, currencyGrouped, countGrouped] = await Promise.all([
        db.invoice.groupBy({
            by: ["customer_id"],
            where: nonZeroBalance,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id", "customer_currency"],
            where: nonZeroBalance,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id"],
            where: nonZeroBalance,
            _count: { id: true },
        }),
    ]);

    for (const customerId of customerIds) {
        const totalGroup = totalGrouped.find(
            (g) => g.customer_id === customerId
        );
        const count =
            countGrouped.find((g) => g.customer_id === customerId)?._count?.id ??
            0;

        // Per-currency amounts fall back to the customer-currency column when the
        // account-currency column is zero.
        const currencyAmounts = currencyGrouped
            .filter((g) => g.customer_id === customerId)
            .map((g) => {
                const accountAmount = g._sum?.outstanding_debt ?? 0;
                const customerAmount = g._sum?.customer_outstanding_debt ?? 0;
                return {
                    currency: g.customer_currency,
                    amount: customerAmount !== 0 ? customerAmount : accountAmount,
                };
            })
            .filter((g) => g.currency && g.amount > 0)
            .sort((a, b) => b.amount - a.amount);

        result.set(customerId, {
            ...EMPTY_DUE,
            total_due_amount: totalGroup?._sum?.outstanding_debt ?? 0,
            no_of_due_invoices: count,
            customer_due_amount1: currencyAmounts[0]?.amount ?? 0,
            customer_due_currency1: currencyAmounts[0]?.currency || null,
            customer_due_amount2: currencyAmounts[1]?.amount ?? 0,
            customer_due_currency2: currencyAmounts[1]?.currency || null,
        });
    }

    return result;
}

/** Overdue totals per customer, including every overdue invoice regardless of balance. */
export async function calculateOutstandingAmountsForCustomers(
    customerIds: number[],
    db: RecalcDbClient
): Promise<Map<number, CustomerOverdueAmounts>> {
    const result = new Map<number, CustomerOverdueAmounts>();
    if (!customerIds.length) {
        return result;
    }

    const overdue = {
        customer_id: { in: customerIds },
        status: "Overdue" as const,
    };

    const [totalGrouped, currencyGrouped, countGrouped] = await Promise.all([
        db.invoice.groupBy({
            by: ["customer_id"],
            where: overdue,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id", "customer_currency"],
            where: overdue,
            _sum: { customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id"],
            where: overdue,
            _count: { id: true },
        }),
    ]);

    for (const customerId of customerIds) {
        const totalGroup = totalGrouped.find(
            (g) => g.customer_id === customerId
        );
        const accountAmount = totalGroup?._sum?.outstanding_debt ?? 0;
        const customerAmount = totalGroup?._sum?.customer_outstanding_debt ?? 0;
        const count =
            countGrouped.find((g) => g.customer_id === customerId)?._count?.id ??
            0;

        // Overdue currency slots are ordered alphabetically, not by size.
        const sortedGroups = currencyGrouped
            .filter((g) => g.customer_id === customerId && !!g.customer_currency)
            .sort((a, b) =>
                (a.customer_currency ?? "").localeCompare(
                    b.customer_currency ?? ""
                )
            );

        result.set(customerId, {
            ...EMPTY_OVERDUE,
            total_outstanding_amount:
                accountAmount !== 0 ? accountAmount : customerAmount,
            no_of_overdue_invoices: count,
            customer_currency1: sortedGroups[0]?.customer_currency ?? null,
            customer_outstanding_amount1:
                sortedGroups[0]?._sum?.customer_outstanding_debt ?? 0,
            customer_currency2: sortedGroups[1]?.customer_currency ?? null,
            customer_outstanding_amount2:
                sortedGroups[1]?._sum?.customer_outstanding_debt ?? 0,
        });
    }

    return result;
}

/**
 * Writes recomputed overdue figures onto the customer's open collection period.
 *
 * Unlike the legacy helper this never closes the period — see the file header.
 */
async function applyCollectionPeriodAmounts(
    customerId: number,
    overdue: CustomerOverdueAmounts,
    db: RecalcDbClient
): Promise<void> {
    const openPeriod = await db.customerCollectionPeriod.findFirst({
        where: { customer_id: customerId, period_end_date: null },
        select: { id: true },
    });

    if (!openPeriod) {
        return;
    }

    await db.customerCollectionPeriod.update({
        where: { id: openPeriod.id },
        data: {
            total_outstanding_amount: overdue.total_outstanding_amount,
            no_of_overdue_invoices: overdue.no_of_overdue_invoices,
            customer_currency1: overdue.customer_currency1,
            customer_outstanding_amount1: overdue.customer_outstanding_amount1,
            customer_currency2: overdue.customer_currency2,
            customer_outstanding_amount2: overdue.customer_outstanding_amount2,
        },
    });
}

/**
 * Recalculates due and overdue rollups for the given customers and persists them
 * on the Customer row (plus the open collection period).
 *
 * Aggregates are set-based (all customers in a few groupBy queries). Writes use
 * a bounded worker pool so large backfills do not update one customer at a time.
 */
export async function recalculateCustomerAmounts(
    customerIds: number[],
    db: RecalcDbClient,
    options?: RecalculateCustomerAmountsOptions
): Promise<Map<number, CustomerAmountsResult>> {
    const result = new Map<number, CustomerAmountsResult>();
    if (!customerIds.length) {
        return result;
    }

    const uniqueIds = Array.from(
        new Set(customerIds.filter((id) => Number.isFinite(id) && id > 0))
    );
    if (uniqueIds.length === 0) {
        return result;
    }

    const concurrency = Math.max(
        1,
        options?.concurrency ?? BALANCE_WRITE_CONCURRENCY
    );
    const progressEvery = Math.max(
        1,
        options?.progressEvery ?? BALANCE_PROGRESS_EVERY
    );
    const total = uniqueIds.length;
    options?.onProgress?.({ processed: 0, total });

    const [dueAmounts, overdueAmounts] = await Promise.all([
        calculateDueAmountsForCustomers(uniqueIds, db),
        calculateOutstandingAmountsForCustomers(uniqueIds, db),
    ]);

    let processed = 0;
    await runWithConcurrency(uniqueIds, concurrency, async (customerId) => {
        const due = dueAmounts.get(customerId) ?? EMPTY_DUE;
        const overdue = overdueAmounts.get(customerId) ?? EMPTY_OVERDUE;
        result.set(customerId, { due, overdue });

        const collectionStatus =
            due.no_of_due_invoices > 0 || overdue.no_of_overdue_invoices > 0
                ? record_status.Active
                : record_status.Inactive;

        await db.customer.update({
            where: { id: customerId },
            data: {
                collection_status: collectionStatus,

                total_due_amount: due.total_due_amount,
                no_of_due_invoices: due.no_of_due_invoices,
                customer_due_amount1: due.customer_due_amount1,
                customer_due_currency1: due.customer_due_currency1,
                customer_due_amount2: due.customer_due_amount2,
                customer_due_currency2: due.customer_due_currency2,

                total_overdue_amount: overdue.total_outstanding_amount,
                number_of_overdue_invoices: overdue.no_of_overdue_invoices,
                customer_overdue_amount1: overdue.customer_outstanding_amount1,
                customer_overdue_currency1: overdue.customer_currency1,
                customer_overdue_amount2: overdue.customer_outstanding_amount2,
                customer_overdue_currency2: overdue.customer_currency2,

                /** Kept in sync for readers still on the pre-multi-currency column. */
                total_invoices_overdue: overdue.total_outstanding_amount,
            },
        });

        await applyCollectionPeriodAmounts(customerId, overdue, db);

        processed += 1;
        if (
            processed === total ||
            processed % progressEvery === 0
        ) {
            options?.onProgress?.({ processed, total });
        }
    });

    return result;
}
