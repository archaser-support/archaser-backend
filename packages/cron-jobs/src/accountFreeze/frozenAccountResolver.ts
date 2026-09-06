import { listRunningSyncAccountIds } from "@archaser/billing-connector";
import type { PrismaClient } from "@prisma/client";

import { jobLog } from "../logging/jobLog";

export type FrozenAccountResolverDeps = {
    prisma: PrismaClient;
    /** Override for tests; defaults to billing-connector sync history store. */
    listRunningSyncAccountIds?: () => Promise<number[]>;
};

async function queryImportProcessingAccountIds(
    prisma: PrismaClient
): Promise<number[]> {
    const rows = await prisma.$queryRaw<Array<{ account_id: number }>>`
        SELECT DISTINCT account_id
        FROM "ImportJob"
        WHERE status = 'Processing'
    `;
    return rows.map((row) => row.account_id);
}

async function queryAsOfBackfillFrozenAccountIds(
    prisma: PrismaClient
): Promise<number[]> {
    const rows = await prisma.$queryRaw<Array<{ account_id: number }>>`
        SELECT DISTINCT account_id
        FROM "CreditAsOfBackfillJob"
        WHERE status IN ('running', 'paused')
    `;
    return rows.map((row) => row.account_id);
}

async function queryRunningSyncAccountIds(
    listRunning?: () => Promise<number[]>
): Promise<number[]> {
    if (!process.env.MONGODB_URI) {
        return [];
    }
    try {
        const resolveRunning =
            listRunning ?? listRunningSyncAccountIds;
        return await resolveRunning();
    } catch (error) {
        jobLog(
            "frozen-account",
            "warn",
            "Mongo RUNNING account lookup failed; Postgres-only freeze",
            {
                error:
                    error instanceof Error ? error.message : String(error),
            }
        );
        return [];
    }
}

function mergeAccountIds(...groups: number[][]): Set<number> {
    const merged = new Set<number>();
    for (const ids of groups) {
        for (const id of ids) {
            merged.add(id);
        }
    }
    return merged;
}

export async function getFrozenAccountIds(
    deps: FrozenAccountResolverDeps
): Promise<Set<number>> {
    const [importIds, backfillIds, syncIds] = await Promise.all([
        queryImportProcessingAccountIds(deps.prisma),
        queryAsOfBackfillFrozenAccountIds(deps.prisma),
        queryRunningSyncAccountIds(deps.listRunningSyncAccountIds),
    ]);
    return mergeAccountIds(importIds, backfillIds, syncIds);
}

export async function isAccountFrozen(
    accountId: number,
    deps: FrozenAccountResolverDeps
): Promise<boolean> {
    const frozen = await getFrozenAccountIds(deps);
    return frozen.has(accountId);
}
