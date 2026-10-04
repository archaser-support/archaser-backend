/**
 * Post-remirror side effects for a parent_customer_id change: capacity gaps,
 * today CTP+CDP sync, scoped async CTP history refresh, breach OR, open-AR rollups.
 *
 * Failures on the synchronous path throw (caller fails / rolls back the save).
 * Async history job start failures are logged and do not fail the save.
 */
import type { DbClient } from "../domain-db";
import type { CreditAsOfBackfillJobView } from "./creditAsOfBackfillJob";
import { setCreditPoolParentChangeSyncStep } from "./creditPoolParentChangeProgress";
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
    await setCreditPoolParentChangeSyncStep({
        accountId: args.accountId,
        step: "capacity_gap",
        dbClient: args.dbClient,
    });
    const { ensureCustomerCapacityGapStored } = await import(
        "./syncCreditInsuranceGapPipeline"
    );
    for (const rootId of uniqueRoots) {
        await ensureCustomerCapacityGapStored(rootId, {
            dbClient: args.dbClient,
        });
    }

    // 2) Today CTP/CDP only — history starts after breach/open-AR so the modal
    // checklist matches the real order (sync steps → history).
    const { syncCreditPoolPolicyTrendsAfterParentChange } = await import(
        "./syncCreditPoolPolicyTrendsAfterParentChange"
    );
    const ctpResult = await syncCreditPoolPolicyTrendsAfterParentChange({
        accountId: args.accountId,
        remirroredRoots: uniqueRoots,
        dbClient: args.dbClient,
        cache: args.cache,
        requestedBy: args.requestedBy ?? null,
        skipAsyncHistoryJob: true,
    });

    // 3) Breach OR onto each remirrored root
    await setCreditPoolParentChangeSyncStep({
        accountId: args.accountId,
        step: "breach_and_open_ar",
        dbClient: args.dbClient,
    });
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

    // 5) Scoped async CTP history (after live rollups)
    let asyncHistoryJob = ctpResult.asyncHistoryJob;
    if (
        ctpResult.historyMode === "today_plus_async" &&
        ctpResult.fromDate != null &&
        ctpResult.customerIds.length > 0
    ) {
        const { inclusiveUtcDaySpan } = await import(
            "./creditPoolParentChangeTiming"
        );
        const daySpan = inclusiveUtcDaySpan(
            ctpResult.fromDate,
            ctpResult.toDate
        );
        // today-only sync already ran; start history when the AR window is wider
        if (daySpan > 1) {
            await setCreditPoolParentChangeSyncStep({
                accountId: args.accountId,
                step: "history",
                dbClient: args.dbClient,
            });
            try {
                const { startCreditPoolParentHistoryJob } = await import(
                    "./creditPoolParentHistoryJob"
                );
                asyncHistoryJob = await startCreditPoolParentHistoryJob({
                    accountId: args.accountId,
                    customerIds: ctpResult.customerIds,
                    fromDate: ctpResult.fromDate,
                    toDate: ctpResult.toDate,
                    requestedBy: args.requestedBy ?? null,
                    dbClient: args.dbClient,
                });
            } catch (error) {
                console.error(
                    "[ParentCustomerCredit] scoped history job failed",
                    {
                        accountId: args.accountId,
                        memberCount: ctpResult.customerIds.length,
                        errorMessage:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }
                );
                const { completeCreditPoolParentChangeSyncProgress } =
                    await import("./creditPoolParentChangeProgress");
                await completeCreditPoolParentChangeSyncProgress({
                    accountId: args.accountId,
                    dbClient: args.dbClient,
                });
            }
        } else {
            const { completeCreditPoolParentChangeSyncProgress } = await import(
                "./creditPoolParentChangeProgress"
            );
            await completeCreditPoolParentChangeSyncProgress({
                accountId: args.accountId,
                dbClient: args.dbClient,
            });
        }
    }

    return { asyncHistoryJob };
}
