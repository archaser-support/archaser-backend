/**
 * Roll pool open-AR denormalized fields onto credit-pool shell parents so
 * header cards (due / overdue / days overdue) and root CTP usage reflect
 * descendant invoices (shell roots usually have no invoices of their own).
 *
 * Sums **leaf** descendants only (customers with no children) so nested shells
 * that already store rolled AR are not double-counted into ancestors — same
 * rule as CTP pool overlay.
 */
import type { DbClient } from "../domain-db";
import { prisma } from "../domain-db";
import {
    createCreditPoolMembershipCache,
    listDescendantCustomerIds,
    resolveCreditPoolMemberIds,
    resolveCustomerCreditPoolRoot,
    type CreditPoolMembershipCache,
} from "./parentCustomerCreditInheritance";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

function minDate(
    a: Date | null | undefined,
    b: Date | null | undefined
): Date | null {
    if (a == null) return b ?? null;
    if (b == null) return a;
    return a.getTime() <= b.getTime() ? a : b;
}

export type CreditPoolOpenArRollup = {
    total_due_amount: number;
    total_overdue_amount: number;
    no_of_due_invoices: number;
    number_of_overdue_invoices: number;
    oldest_invoice_overdue_date: Date | null;
    oldest_invoice_overdue_date_all: Date | null;
};

type OpenArMemberRow = {
    id: number;
    parent_customer_id: number | null;
    total_due_amount: number | null;
    total_overdue_amount: number | null;
    no_of_due_invoices: number | null;
    number_of_overdue_invoices: number | null;
    oldest_invoice_overdue_date: Date | null;
    oldest_invoice_overdue_date_all: Date | null;
};

const OPEN_AR_SELECT = {
    id: true,
    parent_customer_id: true,
    total_due_amount: true,
    total_overdue_amount: true,
    no_of_due_invoices: true,
    number_of_overdue_invoices: true,
    oldest_invoice_overdue_date: true,
    oldest_invoice_overdue_date_all: true,
} as const;

/**
 * Sum live due/overdue amounts for member rows (typically leaf descendants;
 * shell self AR is usually 0).
 */
export function sumOpenArRollupFromMembers(
    members: Array<{
        total_due_amount: number | null;
        total_overdue_amount: number | null;
        no_of_due_invoices: number | null;
        number_of_overdue_invoices: number | null;
        oldest_invoice_overdue_date: Date | null;
        oldest_invoice_overdue_date_all: Date | null;
    }>
): CreditPoolOpenArRollup {
    let total_due_amount = 0;
    let total_overdue_amount = 0;
    let no_of_due_invoices = 0;
    let number_of_overdue_invoices = 0;
    let oldest_invoice_overdue_date: Date | null = null;
    let oldest_invoice_overdue_date_all: Date | null = null;

    for (const row of members) {
        total_due_amount += Number(row.total_due_amount ?? 0) || 0;
        total_overdue_amount += Number(row.total_overdue_amount ?? 0) || 0;
        no_of_due_invoices += Number(row.no_of_due_invoices ?? 0) || 0;
        number_of_overdue_invoices +=
            Number(row.number_of_overdue_invoices ?? 0) || 0;
        oldest_invoice_overdue_date = minDate(
            oldest_invoice_overdue_date,
            row.oldest_invoice_overdue_date
        );
        oldest_invoice_overdue_date_all = minDate(
            oldest_invoice_overdue_date_all,
            row.oldest_invoice_overdue_date_all
        );
    }

    return {
        total_due_amount,
        total_overdue_amount,
        no_of_due_invoices,
        number_of_overdue_invoices,
        oldest_invoice_overdue_date,
        oldest_invoice_overdue_date_all,
    };
}

function buildChildrenByParent(
    rows: readonly OpenArMemberRow[]
): Map<number, number[]> {
    const childrenByParent = new Map<number, number[]>();
    for (const row of rows) {
        if (row.parent_customer_id == null) {
            continue;
        }
        const list = childrenByParent.get(row.parent_customer_id);
        if (list) {
            list.push(row.id);
        } else {
            childrenByParent.set(row.parent_customer_id, [row.id]);
        }
    }
    return childrenByParent;
}

function localDescendantIds(
    shellId: number,
    childrenByParent: Map<number, number[]>
): number[] {
    const out: number[] = [];
    let frontier = [...(childrenByParent.get(shellId) ?? [])];
    const seen = new Set<number>();
    while (frontier.length > 0) {
        const next: number[] = [];
        for (const id of frontier) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
            out.push(id);
            const kids = childrenByParent.get(id);
            if (kids) {
                next.push(...kids);
            }
        }
        frontier = next;
    }
    return out;
}

function leafRowsUnderShell(
    shellId: number,
    byId: Map<number, OpenArMemberRow>,
    childrenByParent: Map<number, number[]>
): OpenArMemberRow[] {
    const out: OpenArMemberRow[] = [];
    for (const id of localDescendantIds(shellId, childrenByParent)) {
        if ((childrenByParent.get(id)?.length ?? 0) > 0) {
            continue;
        }
        const row = byId.get(id);
        if (row) {
            out.push(row);
        }
    }
    return out;
}

async function writeShellOpenAr(
    shellCustomerId: number,
    rollup: CreditPoolOpenArRollup,
    dbClient: DbClient
): Promise<void> {
    await dbClient.customer.update({
        where: { id: shellCustomerId },
        data: {
            total_due_amount: rollup.total_due_amount,
            total_overdue_amount: rollup.total_overdue_amount,
            no_of_due_invoices: rollup.no_of_due_invoices,
            number_of_overdue_invoices: rollup.number_of_overdue_invoices,
            oldest_invoice_overdue_date: rollup.oldest_invoice_overdue_date,
            oldest_invoice_overdue_date_all:
                rollup.oldest_invoice_overdue_date_all,
        },
    });
}

async function patchTodayRootCtpUsage(args: {
    accountId: number;
    rootId: number;
    poolTotalAr: number;
    dbClient: DbClient;
}): Promise<void> {
    const today = startOfTodayUtc();
    await args.dbClient.customerPolicyTrend.updateMany({
        where: {
            account_id: args.accountId,
            customer_id: args.rootId,
            snapshot_date: today,
        },
        data: {
            total_receivables: args.poolTotalAr,
            usage_amount: args.poolTotalAr,
        },
    });
}

/**
 * Write local-descendant open AR onto a shell customer's live Customer row
 * and (for the top root) today's CTP usage / total_receivables.
 */
export async function rollupCreditPoolOpenArToShell(args: {
    shellCustomerId: number;
    accountId: number;
    dbClient?: DbClient;
    /** When true, also patch today's root CTP usage/receivables. Default true. */
    updateTodayCtp?: boolean;
    cache?: CreditPoolMembershipCache;
}): Promise<CreditPoolOpenArRollup | null> {
    const dbClient = args.dbClient ?? prisma;
    const cache = args.cache ?? createCreditPoolMembershipCache();
    const descendants = await listDescendantCustomerIds(
        args.shellCustomerId,
        args.accountId,
        dbClient,
        cache
    );
    if (descendants.length === 0) {
        return null;
    }

    const memberIds = [args.shellCustomerId, ...descendants];
    const rows = (await dbClient.customer.findMany({
        where: { id: { in: memberIds } },
        select: OPEN_AR_SELECT,
    })) as OpenArMemberRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const childrenByParent = buildChildrenByParent(rows);
    const leafMembers = leafRowsUnderShell(
        args.shellCustomerId,
        byId,
        childrenByParent
    );
    const rollup = sumOpenArRollupFromMembers(leafMembers);

    await writeShellOpenAr(args.shellCustomerId, rollup, dbClient);

    if (args.updateTodayCtp !== false) {
        const rootId = await resolveCustomerCreditPoolRoot(
            args.shellCustomerId,
            dbClient,
            cache
        );
        if (rootId === args.shellCustomerId) {
            const poolTotalAr =
                rollup.total_due_amount + rollup.total_overdue_amount;
            await patchTodayRootCtpUsage({
                accountId: args.accountId,
                rootId,
                poolTotalAr,
                dbClient,
            });
        }
    }

    return rollup;
}

/**
 * After a customer amount/insurance change, roll open AR onto every shell
 * ancestor (and the top root) that has descendants — one pool load, in-memory
 * leaf sums, then per-shell updates.
 */
export async function rollupCreditPoolOpenArAfterMemberChange(args: {
    customerId: number;
    accountId: number;
    dbClient?: DbClient;
    cache?: CreditPoolMembershipCache;
}): Promise<void> {
    const dbClient = args.dbClient ?? prisma;
    const cache = args.cache ?? createCreditPoolMembershipCache();
    const { rootCustomerId, memberIds } = await resolveCreditPoolMemberIds(
        args.customerId,
        args.accountId,
        dbClient,
        cache
    );

    const rows = (await dbClient.customer.findMany({
        where: { id: { in: memberIds } },
        select: OPEN_AR_SELECT,
    })) as OpenArMemberRow[];
    if (rows.length === 0) {
        return;
    }

    const byId = new Map(rows.map((row) => [row.id, row]));
    const childrenByParent = buildChildrenByParent(rows);

    const shellsToUpdate = new Set<number>();
    if ((childrenByParent.get(rootCustomerId)?.length ?? 0) > 0) {
        shellsToUpdate.add(rootCustomerId);
    }

    let currentId: number | null = args.customerId;
    const seen = new Set<number>();
    while (currentId != null && !seen.has(currentId)) {
        seen.add(currentId);
        const row = byId.get(currentId);
        const parentId = row?.parent_customer_id ?? null;
        if (parentId == null) {
            break;
        }
        if ((childrenByParent.get(parentId)?.length ?? 0) > 0) {
            shellsToUpdate.add(parentId);
        }
        currentId = parentId;
        if (!byId.has(parentId)) {
            break;
        }
    }

    let rootLeafRollup: CreditPoolOpenArRollup | null = null;

    for (const shellId of shellsToUpdate) {
        const leafMembers = leafRowsUnderShell(shellId, byId, childrenByParent);
        if (leafMembers.length === 0 && !childrenByParent.has(shellId)) {
            continue;
        }
        const rollup = sumOpenArRollupFromMembers(leafMembers);
        await writeShellOpenAr(shellId, rollup, dbClient);
        if (shellId === rootCustomerId) {
            rootLeafRollup = rollup;
        }
    }

    if (rootLeafRollup != null) {
        const poolTotalAr =
            rootLeafRollup.total_due_amount +
            rootLeafRollup.total_overdue_amount;
        await patchTodayRootCtpUsage({
            accountId: args.accountId,
            rootId: rootCustomerId,
            poolTotalAr,
            dbClient,
        });
    }
}
