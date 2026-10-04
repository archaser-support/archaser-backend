/**
 * Attribute linked-child invoices into credit-pool root KPI maps.
 *
 * Portfolio / CDP customer cohorts stay root-only; invoice-based amounts
 * (AR, terms breach, reporting countdown, exposure) must still include
 * descendant invoices under each included root.
 */
import type { Prisma } from "@prisma/client";

import { prisma, type DbClient } from "../domain-db";
import {
    createCreditPoolMembershipCache,
    listDescendantCustomerIds,
    resolveCustomerCreditPoolRoot,
    type CreditPoolMembershipCache,
} from "./parentCustomerCreditInheritance";

export type CreditPoolMemberAttribution = {
    /** Root + all descendants for every included root (deduped). */
    memberIds: number[];
    /** member customer id → pool root customer id (roots map to self). */
    rootByMemberId: Map<number, number>;
};

/**
 * Expand included credit-pool roots to their full member sets and build a
 * member→root attribution map.
 */
export async function expandCreditPoolRootsToMembers(
    accountId: number,
    rootCustomerIds: readonly number[],
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<CreditPoolMemberAttribution> {
    const membershipCache = cache ?? createCreditPoolMembershipCache();
    const rootByMemberId = new Map<number, number>();
    const memberIdSet = new Set<number>();
    const uniqueRoots = [...new Set(rootCustomerIds)].filter(Number.isFinite);

    for (const rootId of uniqueRoots) {
        rootByMemberId.set(rootId, rootId);
        memberIdSet.add(rootId);
        const descendants = await listDescendantCustomerIds(
            rootId,
            accountId,
            dbClient,
            membershipCache
        );
        for (const descendantId of descendants) {
            rootByMemberId.set(descendantId, rootId);
            memberIdSet.add(descendantId);
        }
    }

    return {
        memberIds: [...memberIdSet],
        rootByMemberId,
    };
}

/**
 * Attribution for a root-only customer cohort (credit dashboard reports).
 * Use with {@link attributeAmountsToCreditPoolRoots} / {@link attributeListsToCreditPoolRoots}
 * so shell parents pick up descendant invoice AR.
 */
export async function creditPoolRootAttributionForCustomers(
    accountId: number,
    rootCustomerIds: readonly number[],
    dbClient: DbClient = prisma
): Promise<CreditPoolMemberAttribution & { allowedRootIds: Set<number> }> {
    const allowedRootIds = new Set(
        [...new Set(rootCustomerIds)].filter(Number.isFinite)
    );
    const attribution = await expandCreditPoolRootsToMembers(
        accountId,
        [...allowedRootIds],
        dbClient
    );
    return { ...attribution, allowedRootIds };
}

/**
 * Resolve pool root for invoice-keyed customer ids (customers that actually
 * have open AR / invoice rows). Prefer this over expanding every live root
 * when rolling dashboard amount maps.
 */
export async function resolveCreditPoolRootsForMemberIds(
    memberIds: readonly number[],
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<Map<number, number>> {
    const membershipCache = cache ?? createCreditPoolMembershipCache();
    const rootByMemberId = new Map<number, number>();
    const unique = [...new Set(memberIds.filter(Number.isFinite))];
    await Promise.all(
        unique.map(async (memberId) => {
            rootByMemberId.set(
                memberId,
                await resolveCustomerCreditPoolRoot(
                    memberId,
                    dbClient,
                    membershipCache
                )
            );
        })
    );
    return rootByMemberId;
}

/**
 * Invoice-report `customerId` drill-down scope.
 * Shell roots (and any node with descendants) expand to that subtree so child
 * invoices appear; leaves stay a single id.
 */
export async function resolveInvoiceReportCustomerIds(
    accountId: number,
    customerId: number | null | undefined,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<number[] | undefined> {
    if (customerId == null || !Number.isFinite(customerId)) {
        return undefined;
    }
    const { memberIds } = await expandCreditPoolRootsToMembers(
        accountId,
        [customerId],
        dbClient,
        cache
    );
    return memberIds.length > 0 ? memberIds : [customerId];
}

/** Apply shell-root–expanded `customerId` drill-down onto an invoice where. */
export async function applyInvoiceReportCustomerIdScope(
    accountId: number,
    where: Prisma.InvoiceWhereInput,
    customerId: number | null | undefined,
    dbClient: DbClient = prisma,
    cache?: CreditPoolMembershipCache
): Promise<Prisma.InvoiceWhereInput> {
    const invoiceCustomerIds = await resolveInvoiceReportCustomerIds(
        accountId,
        customerId,
        dbClient,
        cache
    );
    if (invoiceCustomerIds == null) {
        return where;
    }
    return { ...where, customer_id: { in: invoiceCustomerIds } };
}

/**
 * Roll per-customer amounts onto pool roots. When `allowedRootIds` is set,
 * drop amounts whose resolved root is outside that set.
 */
export function attributeAmountsToCreditPoolRoots(
    amountsByCustomerId: Map<number, number>,
    rootByMemberId: Map<number, number>,
    options?: { allowedRootIds?: ReadonlySet<number> }
): Map<number, number> {
    const out = new Map<number, number>();
    for (const [customerId, amount] of amountsByCustomerId) {
        if (!Number.isFinite(amount) || amount === 0) {
            continue;
        }
        const rootId = rootByMemberId.get(customerId) ?? customerId;
        if (
            options?.allowedRootIds != null &&
            !options.allowedRootIds.has(rootId)
        ) {
            continue;
        }
        out.set(rootId, (out.get(rootId) ?? 0) + amount);
    }
    return out;
}

/**
 * Expand a set of root customer IDs to every pool member attributed to those roots.
 */
export function expandRootIdSetToPoolMembers(
    rootIds: readonly number[],
    rootByMemberId: Map<number, number>
): Set<number> {
    const allowedRoots = new Set(rootIds);
    const out = new Set<number>();
    for (const [memberId, rootId] of rootByMemberId) {
        if (allowedRoots.has(rootId)) {
            out.add(memberId);
        }
    }
    // Roots with no descendants still appear via identity entries.
    for (const rootId of allowedRoots) {
        out.add(rootId);
    }
    return out;
}

/**
 * Remap row `customerId` onto the pool root so shared-limit waterfall / at-risk
 * maps run once per included root (descendant invoices compete for the root limit).
 */
export function attributeInvoiceCustomerIdsToCreditPoolRoots<
    T extends { customerId: number },
>(
    rows: readonly T[],
    rootByMemberId: Map<number, number>,
    options?: { allowedRootIds?: ReadonlySet<number> }
): T[] {
    return rows.map((row) => {
        const rootId = rootByMemberId.get(row.customerId) ?? row.customerId;
        if (
            options?.allowedRootIds != null &&
            !options.allowedRootIds.has(rootId)
        ) {
            return row;
        }
        if (rootId === row.customerId) {
            return row;
        }
        return { ...row, customerId: rootId };
    });
}

/**
 * Merge per-customer list maps onto pool roots (e.g. at-risk invoice inputs).
 */
export function attributeListsToCreditPoolRoots<T>(
    listsByCustomerId: Map<number, T[]>,
    rootByMemberId: Map<number, number>,
    options?: { allowedRootIds?: ReadonlySet<number> }
): Map<number, T[]> {
    const out = new Map<number, T[]>();
    for (const [customerId, list] of listsByCustomerId) {
        if (list.length === 0) {
            continue;
        }
        const rootId = rootByMemberId.get(customerId) ?? customerId;
        if (
            options?.allowedRootIds != null &&
            !options.allowedRootIds.has(rootId)
        ) {
            continue;
        }
        const existing = out.get(rootId);
        if (existing == null) {
            out.set(rootId, [...list]);
        } else {
            existing.push(...list);
        }
    }
    return out;
}

/** Minimal customer shape loaded when remapping invoice rows onto pool roots. */
const POOL_ROOT_CUSTOMER_SELECT = {
    id: true,
    customer_number: true,
    parent_customer_id: true,
    customer_due_currency1: true,
    customer_due_currency2: true,
    customer_overdue_currency1: true,
    customer_overdue_currency2: true,
    Person: {
        select: {
            full_name: true,
            first_name: true,
            last_name: true,
        },
    },
    Company: { select: { name: true } },
} as const;

type InvoiceRowWithCustomer = {
    customer_id?: number | null;
    Customer?: Record<string, unknown> | null;
};

/**
 * Remap invoice rows so linked-child invoices appear under the pool root
 * customer (id + Customer display fields). Keeps invoice identity; only the
 * customer attribution changes — matches CDP terms/reporting cohort counts.
 */
export async function attributePrismaInvoiceCustomersToCreditPoolRoots<
    T extends InvoiceRowWithCustomer,
>(
    accountId: number,
    rows: T[],
    dbClient: DbClient = prisma
): Promise<T[]> {
    if (rows.length === 0) {
        return rows;
    }

    const memberIds = [
        ...new Set(
            rows
                .map((row) => row.customer_id)
                .filter((id): id is number => id != null && Number.isFinite(id))
        ),
    ];
    if (memberIds.length === 0) {
        return rows;
    }

    const cache = createCreditPoolMembershipCache();
    const rootByMemberId = new Map<number, number>();
    await Promise.all(
        memberIds.map(async (memberId) => {
            rootByMemberId.set(
                memberId,
                await resolveCustomerCreditPoolRoot(memberId, dbClient, cache)
            );
        })
    );

    const distinctRemappedRoots = [
        ...new Set(
            memberIds
                .map((memberId) => rootByMemberId.get(memberId) ?? memberId)
                .filter((rootId, i) => rootId !== memberIds[i])
        ),
    ];

    if (distinctRemappedRoots.length === 0) {
        return rows;
    }

    const roots = await dbClient.customer.findMany({
        where: {
            account_id: accountId,
            id: { in: distinctRemappedRoots },
        },
        select: POOL_ROOT_CUSTOMER_SELECT,
    });
    const rootById = new Map(roots.map((root) => [root.id, root]));

    return rows.map((row) => {
        const memberId = row.customer_id;
        if (memberId == null) {
            return row;
        }
        const rootId = rootByMemberId.get(memberId) ?? memberId;
        if (rootId === memberId) {
            return row;
        }
        const root = rootById.get(rootId);
        if (root == null) {
            return row;
        }
        const nextCustomer =
            row.Customer != null
                ? ({ ...row.Customer, ...root, id: rootId } as Record<
                      string,
                      unknown
                  >)
                : (root as unknown as Record<string, unknown>);
        return {
            ...row,
            customer_id: rootId,
            Customer: nextCustomer,
        };
    });
}
