import { listRunningSyncAccountIds } from "@archaser/billing-connector";
import type { PrismaClient } from "@prisma/client";

import { jobLog } from "../logging/jobLog";
import { sweepStaleProcessingImportJobs } from "./sweepStaleProcessingImportJobs";

/** Keep in sync with ACCOUNT_BACKGROUND_JOB_KIND in credit-insurance-domain. */
const JOB_KIND_CREDIT_ASOF_BACKFILL = "credit_asof_backfill";
const JOB_KIND_VAT_BASIS_REFRESH = "vat_basis_refresh";

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
        FROM "AccountBackgroundJob"
        WHERE (
            (
                job_kind = ${JOB_KIND_CREDIT_ASOF_BACKFILL}
                AND status IN ('running', 'paused')
            )
            OR (
                job_kind = ${JOB_KIND_VAT_BASIS_REFRESH}
                AND status = 'running'
            )
        )
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
    await sweepStaleProcessingImportJobs({ prisma: deps.prisma });

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
