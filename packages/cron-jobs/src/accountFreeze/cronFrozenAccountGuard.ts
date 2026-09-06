import type { PrismaClient } from "@prisma/client";

import { getDefaultCronFrozenAccountMetrics } from "./defaultCronFrozenAccountMetrics";
import {
    logFrozenAccountSkips,
    reportFrozenAccountSkips,
} from "./frozenAccountObservability";
import {
    getFrozenAccountIds,
    type FrozenAccountResolverDeps,
} from "./frozenAccountResolver";

export type CronFrozenAccountGuardOptions = Pick<
    FrozenAccountResolverDeps,
    "listRunningSyncAccountIds"
> & {
    /** Test hook: bypass ImportJob query and treat these account IDs as frozen. */
    frozenImportAccountIds?: number[];
};

export type CronFrozenAccountGuard = {
    frozenAccountIds: ReadonlySet<number>;
    isFrozen(accountId: number): boolean;
    accountIdNotInFilter(): { account_id?: { notIn: number[] } };
    reportSkips(skippedAccountIds: Iterable<number>): void;
};

export async function beginCronFrozenAccountGuard(
    prisma: PrismaClient,
    jobName: string,
    options?: CronFrozenAccountGuardOptions
): Promise<CronFrozenAccountGuard> {
    const frozenAccountIds =
        options?.frozenImportAccountIds != null
            ? new Set(options.frozenImportAccountIds)
            : await getFrozenAccountIds({
                  prisma,
                  listRunningSyncAccountIds:
                      options?.listRunningSyncAccountIds,
              });
    const frozenList = [...frozenAccountIds].sort((a, b) => a - b);
    let reported = false;

    return {
        frozenAccountIds,
        isFrozen(accountId: number) {
            return frozenAccountIds.has(accountId);
        },
        accountIdNotInFilter() {
            if (frozenList.length === 0) {
                return {};
            }
            return { account_id: { notIn: frozenList } };
        },
        reportSkips(skippedAccountIds: Iterable<number>) {
            if (reported) {
                return;
            }
            const skipped = [
                ...new Set(
                    [...skippedAccountIds].filter((id) =>
                        frozenAccountIds.has(id)
                    )
                ),
            ];
            if (skipped.length === 0) {
                return;
            }
            reported = true;
            const payload = {
                jobName,
                frozenAccountIds: frozenList,
                frozenCount: frozenList.length,
                skippedCount: skipped.length,
            };
            const metrics = getDefaultCronFrozenAccountMetrics();
            if (metrics) {
                reportFrozenAccountSkips(metrics, payload);
            } else {
                logFrozenAccountSkips(payload);
            }
        },
    };
}

export function partitionByFrozenAccount<T extends { account_id: number | null }>(
    items: T[],
    frozenAccountIds: ReadonlySet<number>
): { kept: T[]; skippedAccountIds: number[] } {
    const kept: T[] = [];
    const skippedAccountIds: number[] = [];
    for (const item of items) {
        const accountId = item.account_id;
        if (accountId != null && frozenAccountIds.has(accountId)) {
            skippedAccountIds.push(accountId);
            continue;
        }
        kept.push(item);
    }
    return { kept, skippedAccountIds };
}
