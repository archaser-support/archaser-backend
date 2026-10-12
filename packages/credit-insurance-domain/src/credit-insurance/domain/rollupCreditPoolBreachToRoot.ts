/**
 * OR leaf MEP overdue_block onto every credit-pool member (shells + siblings)
 * so parent/sibling headers, notifications, and new-invoice MEP stamps share
 * one pool posture.
 */
import type { DbClient } from "../domain-db";
import { prisma } from "../domain-db";
import { computeOwnCustomerOverdueBlock } from "./computeOwnCustomerOverdueBlock";
import { resolveCreditPoolMemberIds } from "./parentCustomerCreditInheritance";

/**
 * Set every pool member's `overdue_block` = OR of invoice-derived leaf blocks
 * (recomputed, so prior sibling contagion cannot stick). Solo customers are
 * left untouched. Also re-overlay today's root CTP (terms breach, gap,
 * at-risk, health) from leaf CTP rows.
 */
export async function rollupCreditPoolBreachToRoot(args: {
    customerId: number;
    accountId: number;
    dbClient?: DbClient;
    /**
     * When the caller just computed the root's own invoice-derived block
     * (e.g. syncCustomerInsuranceFields on the root), pass it so we do not
     * treat a prior rolled-up true as the root's own signal.
     */
    rootOwnOverdueBlock?: boolean;
    /**
     * Optional freshly computed own blocks for leaves already synced in this
     * request (avoids a second invoice scan for that leaf).
     */
    leafOwnOverdueBlockById?: ReadonlyMap<number, boolean>;
}): Promise<{ rootCustomerId: number; overdueBlock: boolean }> {
    const dbClient = args.dbClient ?? prisma;
    const { rootCustomerId, memberIds } = await resolveCreditPoolMemberIds(
        args.customerId,
        args.accountId,
        dbClient
    );
    const childIds = memberIds.filter((id) => id !== rootCustomerId);
    if (childIds.length === 0) {
        const root = await dbClient.customer.findUnique({
            where: { id: rootCustomerId },
            select: { overdue_block: true },
        });
        return {
            rootCustomerId,
            overdueBlock:
                args.rootOwnOverdueBlock ?? root?.overdue_block === true,
        };
    }

    const rows = await dbClient.customer.findMany({
        where: { id: { in: [...memberIds] } },
        select: {
            id: true,
            parent_customer_id: true,
        },
    });

    const memberIdSet = new Set(memberIds);
    const childrenByParent = new Map<number, number[]>();
    for (const row of rows) {
        const parentId = row.parent_customer_id;
        if (parentId == null || !memberIdSet.has(parentId)) {
            continue;
        }
        const siblings = childrenByParent.get(parentId) ?? [];
        siblings.push(row.id);
        childrenByParent.set(parentId, siblings);
    }

    const leafIds = memberIds.filter(
        (id) => (childrenByParent.get(id) ?? []).length === 0
    );

    const ownByLeafId = new Map<number, boolean>();
    await Promise.all(
        leafIds.map(async (leafId) => {
            const provided = args.leafOwnOverdueBlockById?.get(leafId);
            if (provided != null) {
                ownByLeafId.set(leafId, provided);
                return;
            }
            if (
                leafId === rootCustomerId &&
                args.rootOwnOverdueBlock !== undefined
            ) {
                ownByLeafId.set(leafId, Boolean(args.rootOwnOverdueBlock));
                return;
            }
            ownByLeafId.set(
                leafId,
                await computeOwnCustomerOverdueBlock(leafId, dbClient)
            );
        })
    );

    let overdueBlock = [...ownByLeafId.values()].some((v) => v);
    if (
        args.customerId === rootCustomerId &&
        args.rootOwnOverdueBlock !== undefined
    ) {
        overdueBlock = overdueBlock || Boolean(args.rootOwnOverdueBlock);
    }

    // Contagion: every pool member (parent + all children) shares the OR.
    await dbClient.customer.updateMany({
        where: { id: { in: [...memberIds] } },
        data: { overdue_block: overdueBlock },
    });

    const { overlayCreditPoolRootTrendToday } = await import(
        "./syncCreditPoolPolicyTrendsAfterParentChange"
    );
    await overlayCreditPoolRootTrendToday({
        accountId: args.accountId,
        rootCustomerId,
        dbClient,
        source: "rollupCreditPoolBreachToRoot",
    });

    return { rootCustomerId, overdueBlock };
}
