/**
 * Post-remirror side effects for a parent_customer_id change: capacity gaps,
 * today CTP+CDP sync, scoped async CTP history refresh, breach OR, open-AR rollups.
 *
 * Failures on the synchronous path throw (caller fails / rolls back the save).
 * Async history job start failures are logged and do not fail the save.
 */
import type { DbClient } from "../domain-db";
import type { CreditAsOfBackfillJobView } from "./creditAsOfBackfillJob";
import type { CreditPoolMembershipCache } from "./parentCustomerCreditInheritance";

export async function runCreditPoolParentChangeSideEffects(args: {
    accountId: number;
    customerId: number;
    previousParentId: number | null;
    nextParentId: number | null;
    remirroredRoots: readonly number[];
    dbClient: DbClient;
    cache: CreditPoolMembershipCache;
    requestedBy?: string | null;
}): Promise<{
    asyncHistoryJob: CreditAsOfBackfillJobView | null;
}> {
    const uniqueRoots = [...new Set(args.remirroredRoots)].filter(Number.isFinite);
    if (uniqueRoots.length === 0) {
        return { asyncHistoryJob: null };
    }

    // 1) Live capacity gaps for every remirrored pool root
    const { ensureCustomerCapacityGapStored } = await import(
        "./syncCreditInsuranceGapPipeline"
    );
    for (const rootId of uniqueRoots) {
        await ensureCustomerCapacityGapStored(rootId, {
            dbClient: args.dbClient,
        });
    }

    // 2) Today CTP/CDP + start scoped async CTP history (no CDP history)
    const { syncCreditPoolPolicyTrendsAfterParentChange } = await import(
        "./syncCreditPoolPolicyTrendsAfterParentChange"
    );
    const ctpResult = await syncCreditPoolPolicyTrendsAfterParentChange({
        accountId: args.accountId,
        remirroredRoots: uniqueRoots,
        dbClient: args.dbClient,
        cache: args.cache,
        requestedBy: args.requestedBy ?? null,
    });

    // 3) Breach OR onto each remirrored root
    const { rollupCreditPoolBreachToRoot } = await import(
        "./rollupCreditPoolBreachToRoot"
    );
    for (const rootId of uniqueRoots) {
        await rollupCreditPoolBreachToRoot({
            customerId: rootId,
            accountId: args.accountId,
            dbClient: args.dbClient,
        });
    }

    // 4) Live header AR on shell ancestors of the changed customer / roots
    const { rollupCreditPoolOpenArAfterMemberChange } = await import(
        "./rollupCreditPoolOpenArToRoot"
    );
    const rollupTargets = new Set<number>([
        args.customerId,
        ...uniqueRoots,
    ]);
    if (args.previousParentId != null) {
        rollupTargets.add(args.previousParentId);
    }
    if (args.nextParentId != null) {
        rollupTargets.add(args.nextParentId);
    }
    for (const targetId of rollupTargets) {
        await rollupCreditPoolOpenArAfterMemberChange({
            customerId: targetId,
            accountId: args.accountId,
            dbClient: args.dbClient,
            cache: args.cache,
        });
    }

    return { asyncHistoryJob: ctpResult.asyncHistoryJob };
}
