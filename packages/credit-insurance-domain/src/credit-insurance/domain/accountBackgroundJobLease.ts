import { Prisma } from "@prisma/client";
import { ACCOUNT_BACKGROUND_JOB_KIND } from "./accountBackgroundJob";
import { type DbClient } from "../domain-db";

type PrismaClientLike = DbClient;

function readEnvInt(
    name: string,
    defaultValue: number,
    min: number,
    max: number
): number {
    const raw = process.env[name];
    if (raw == null || raw.trim() === "") {
        return defaultValue;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }
    return Math.max(min, Math.min(max, parsed));
}

/** Touch `updated_at` at least this often while Generate is writing (including mid-day). */
export const CREDIT_ASOF_HEARTBEAT_INTERVAL_MS = readEnvInt(
    "CREDIT_ASOF_BACKFILL_HEARTBEAT_INTERVAL_MS",
    30_000,
    5_000,
    60_000
);

/** Treat Generate as dead (reclaim / new Generate may take over) after this gap. */
export const CREDIT_ASOF_HEARTBEAT_STALE_MS = Math.max(
    CREDIT_ASOF_HEARTBEAT_INTERVAL_MS * 2,
    readEnvInt(
        "CREDIT_ASOF_BACKFILL_HEARTBEAT_STALE_MS",
        120_000,
        30_000,
        600_000
    )
);

const PARENT_HISTORY_KIND =
    ACCOUNT_BACKGROUND_JOB_KIND.CREDIT_POOL_PARENT_HISTORY;
const CREDIT_ASOF_KIND = ACCOUNT_BACKGROUND_JOB_KIND.CREDIT_ASOF_BACKFILL;

const PARENT_HISTORY_BLOCKS_GENERATE = new Set([
    "running",
    "paused",
    "syncing",
]);

export type BackgroundJobLeaseRow = {
    status: string;
    updated_at: Date;
    run_token: string | null;
};

export function newAccountBackgroundJobRunToken(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isAccountBackgroundJobHeartbeatStale(
    updatedAt: Date | null | undefined,
    now: Date = new Date(),
    staleMs: number = CREDIT_ASOF_HEARTBEAT_STALE_MS
): boolean {
    if (updatedAt == null) {
        return true;
    }
    return now.getTime() - new Date(updatedAt).getTime() >= staleMs;
}

export function creditAsOfHeartbeatStaleCutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - CREDIT_ASOF_HEARTBEAT_STALE_MS);
}

export function parentHistoryStatusBlocksGenerate(
    status: string | null | undefined
): boolean {
    return status != null && PARENT_HISTORY_BLOCKS_GENERATE.has(status);
}

export function generateStatusBlocksParentHistory(
    status: string | null | undefined,
    updatedAt: Date | null | undefined,
    now: Date = new Date()
): boolean {
    return (
        status === "running" &&
        !isAccountBackgroundJobHeartbeatStale(updatedAt, now)
    );
}

export async function loadAccountBackgroundJobLease(
    accountId: number,
    jobKind: string,
    db: PrismaClientLike
): Promise<BackgroundJobLeaseRow | null> {
    const rows = await db.$queryRaw<BackgroundJobLeaseRow[]>`
        SELECT status, updated_at, run_token
        FROM "AccountBackgroundJob"
        WHERE account_id = ${accountId}
          AND job_kind = ${jobKind}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export type AccountSnapshotLeaseBlocker = {
    accountId: number;
    jobKind: string;
    status: string;
};

/**
 * Generate / parent-history jobs that own an account's snapshot days, so
 * other writers (rewrite drain, nightly tips) must skip the account. A
 * `running` Generate stops blocking once its heartbeat is stale (dead worker,
 * reclaim pending); `paused` Generate resumes from its checkpoint and
 * parent-history has no steady heartbeat, so those block until they end.
 */
export async function loadAccountSnapshotLeaseBlockers(
    accountIds: number[],
    db: PrismaClientLike,
    now: Date = new Date()
): Promise<Map<number, AccountSnapshotLeaseBlocker>> {
    const blockers = new Map<number, AccountSnapshotLeaseBlocker>();
    if (accountIds.length === 0) {
        return blockers;
    }
    const staleCutoff = creditAsOfHeartbeatStaleCutoff(now);
    const rows = await db.$queryRaw<
        Array<{ account_id: number; job_kind: string; status: string }>
    >`
        SELECT account_id, job_kind, status
        FROM "AccountBackgroundJob"
        WHERE account_id IN (${Prisma.join(accountIds)})
          AND job_kind IN (${CREDIT_ASOF_KIND}, ${PARENT_HISTORY_KIND})
          AND status IN ('running', 'paused')
          AND NOT (
            job_kind = ${CREDIT_ASOF_KIND}
            AND status = 'running'
            AND updated_at < ${staleCutoff}
          )
    `;
    for (const row of rows) {
        const accountId = Number(row.account_id);
        if (!blockers.has(accountId)) {
            blockers.set(accountId, {
                accountId,
                jobKind: row.job_kind,
                status: row.status,
            });
        }
    }
    return blockers;
}

export async function findAccountSnapshotLeaseBlocker(
    accountId: number,
    db: PrismaClientLike,
    now: Date = new Date()
): Promise<AccountSnapshotLeaseBlocker | null> {
    const blockers = await loadAccountSnapshotLeaseBlockers(
        [accountId],
        db,
        now
    );
    return blockers.get(accountId) ?? null;
}

export function warnSnapshotWriterSkippedForLease(
    writer: string,
    blocker: AccountSnapshotLeaseBlocker
): void {
    console.warn(`[${writer}] skipped account: snapshot job holds lease`, {
        accountId: blocker.accountId,
        blockingJobKind: blocker.jobKind,
        blockingJobStatus: blocker.status,
    });
}

export async function loadParentHistoryLease(
    accountId: number,
    db: PrismaClientLike
): Promise<BackgroundJobLeaseRow | null> {
    return loadAccountBackgroundJobLease(accountId, PARENT_HISTORY_KIND, db);
}

export async function loadCreditAsOfBackfillLease(
    accountId: number,
    db: PrismaClientLike
): Promise<BackgroundJobLeaseRow | null> {
    return loadAccountBackgroundJobLease(accountId, CREDIT_ASOF_KIND, db);
}
