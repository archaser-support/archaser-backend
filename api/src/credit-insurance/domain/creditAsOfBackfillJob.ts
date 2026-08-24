import { PrismaClient } from "@prisma/client";

import { prisma } from "../domain-db";
import {
    isAdminBackfillBlockingDrain,
    resolveRewriteDrainStart,
} from "./asOfRewriteQueue";

type PrismaClientLike = PrismaClient;

export type CreditAsOfBackfillStatus =
    | "idle"
    | "running"
    | "paused"
    | "failed"
    | "complete";

export type CreditAsOfBackfillJobView = {
    status: CreditAsOfBackfillStatus;
    fromDate: string | null;
    toDate: string | null;
    checkpointDate: string | null;
    daysTotal: number;
    daysDone: number;
    lastError: string | null;
    requestedBy: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    skipReportingBreach: boolean;
};

type JobRow = {
    account_id: number;
    status: string;
    from_date: Date | null;
    to_date: Date | null;
    checkpoint_date: Date | null;
    days_total: number;
    days_done: number;
    last_error: string | null;
    requested_by: string | null;
    started_at: Date | null;
    updated_at: Date;
};

function toUtcDayStart(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function toYmd(date: Date | null | undefined): string | null {
    if (!date) {
        return null;
    }
    return toUtcDayStart(date).toISOString().slice(0, 10);
}

export function countInclusiveUtcDays(fromDate: Date, toDate: Date): number {
    const from = toUtcDayStart(fromDate);
    const to = toUtcDayStart(toDate);
    if (to.getTime() < from.getTime()) {
        return 0;
    }
    return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

export function enumerateUtcDaysInclusive(fromDate: Date, toDate: Date): Date[] {
    const days: Date[] = [];
    const cursor = toUtcDayStart(fromDate);
    const end = toUtcDayStart(toDate);
    let guard = 0;
    while (cursor.getTime() <= end.getTime() && guard < 4000) {
        days.push(new Date(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard += 1;
    }
    return days;
}

function normalizeStatus(raw: string | null | undefined): CreditAsOfBackfillStatus {
    switch (raw) {
        case "running":
        case "paused":
        case "failed":
        case "complete":
        case "idle":
            return raw;
        default:
            return "idle";
    }
}

function jobView(
    row: JobRow | null,
    accountId?: number
): CreditAsOfBackfillJobView {
    const skipReportingBreach =
        accountId == null
            ? true
            : skipReportingBreachByAccount.get(accountId) !== false;
    if (!row) {
        return {
            status: "idle",
            fromDate: null,
            toDate: null,
            checkpointDate: null,
            daysTotal: 0,
            daysDone: 0,
            lastError: null,
            requestedBy: null,
            startedAt: null,
            updatedAt: null,
            skipReportingBreach,
        };
    }
    return {
        status: normalizeStatus(row.status),
        fromDate: toYmd(row.from_date),
        toDate: toYmd(row.to_date),
        checkpointDate: toYmd(row.checkpoint_date),
        daysTotal: Number(row.days_total ?? 0),
        daysDone: Number(row.days_done ?? 0),
        lastError: row.last_error,
        requestedBy: row.requested_by,
        startedAt: row.started_at?.toISOString() ?? null,
        updatedAt: row.updated_at?.toISOString() ?? null,
        skipReportingBreach,
    };
}

async function loadJob(
    accountId: number,
    db: PrismaClientLike
): Promise<JobRow | null> {
    const rows = await db.$queryRaw<JobRow[]>`
        SELECT
            account_id,
            status,
            from_date,
            to_date,
            checkpoint_date,
            days_total,
            days_done,
            last_error,
            requested_by,
            started_at,
            updated_at
        FROM "CreditAsOfBackfillJob"
        WHERE account_id = ${accountId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function getCreditAsOfBackfillJobStatus(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? prisma;
    return jobView(await loadJob(accountId, db), accountId);
}

export class CreditAsOfBackfillConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CreditAsOfBackfillConflictError";
    }
}

const runnersInFlight = new Set<number>();
/** Generate-click only: keep ignore-reporting-late for this process run / retry. */
const skipReportingBreachByAccount = new Map<number, boolean>();

type AsOfLines = import("./asOfOpenAr").AsOfOpenInvoiceLine[];

type BackfillWriters = {
    syncCustomerPolicyTrendSnapshotForAccount: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: AsOfLines;
            ignoreReportingBreach?: boolean;
        }
    ) => Promise<unknown>;
    takeCreditDashboardDailySnapshotsForAccount: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: AsOfLines;
            ignoreReportingBreach?: boolean;
        }
    ) => Promise<unknown>;
};

type LoadAsOfLines = (
    accountId: number,
    asOfDate: Date
) => Promise<AsOfLines>;

async function resolveWriters(
    writers?: Partial<BackfillWriters>
): Promise<BackfillWriters> {
    const syncCpt =
        writers?.syncCustomerPolicyTrendSnapshotForAccount ??
        (
            await import("./customerPolicyTrendService")
        ).syncCustomerPolicyTrendSnapshotForAccount;
    const takeDashboard =
        writers?.takeCreditDashboardDailySnapshotsForAccount ??
        (
            await import("./creditDashboardSnapshotService")
        ).takeCreditDashboardDailySnapshotsForAccount;
    return {
        syncCustomerPolicyTrendSnapshotForAccount: syncCpt,
        takeCreditDashboardDailySnapshotsForAccount: takeDashboard,
    };
}

/**
 * Day-by-day as-of rewrite for one account. Checks pause between days.
 * Safe to call while status is already `running` (used after start/retry).
 */
export async function runCreditAsOfBackfillJob(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        writers?: Partial<BackfillWriters>;
        loadAsOfLines?: LoadAsOfLines;
        now?: Date;
    }
): Promise<CreditAsOfBackfillJobView> {
    if (runnersInFlight.has(accountId)) {
        return getCreditAsOfBackfillJobStatus(accountId, {
            dbClient: options?.dbClient,
        });
    }
    runnersInFlight.add(accountId);
    const db = options?.dbClient ?? prisma;
    const now = options?.now ?? new Date();
    try {
        const writers = await resolveWriters(options?.writers);
        const loadAsOfLines: LoadAsOfLines =
            options?.loadAsOfLines ??
            (async (id, asOfDate) => {
                const { loadAsOfOpenInvoiceCandidates } = await import(
                    "./asOfOpenAr"
                );
                return loadAsOfOpenInvoiceCandidates(id, asOfDate, {
                    dbClient: options?.dbClient,
                });
            });
        let job = await loadJob(accountId, db);
        if (!job || job.from_date == null || job.to_date == null) {
            return jobView(job, accountId);
        }
        if (job.status !== "running") {
            return jobView(job, accountId);
        }

        const resumeFrom = resolveRewriteDrainStart(
            job.from_date,
            job.checkpoint_date
        );
        const days = enumerateUtcDaysInclusive(resumeFrom, job.to_date);
        const baseDone = Math.max(
            0,
            countInclusiveUtcDays(job.from_date, job.to_date) - days.length
        );

        for (let i = 0; i < days.length; i++) {
            const day = days[i]!;
            const latest = await loadJob(accountId, db);
            if (!latest || latest.status !== "running") {
                return jobView(latest, accountId);
            }

            try {
                const asOfLines = await loadAsOfLines(accountId, day);
                const ignoreReportingBreach =
                    skipReportingBreachByAccount.get(accountId) !== false;
                await writers.syncCustomerPolicyTrendSnapshotForAccount(
                    accountId,
                    { snapshotDate: day, asOfLines, ignoreReportingBreach }
                );
                await writers.takeCreditDashboardDailySnapshotsForAccount(
                    accountId,
                    { snapshotDate: day, asOfLines, ignoreReportingBreach }
                );
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                await db.$executeRaw`
                    UPDATE "CreditAsOfBackfillJob"
                    SET status = 'failed',
                        last_error = ${message.slice(0, 1000)},
                        updated_at = ${now}
                    WHERE account_id = ${accountId}
                `;
                return getCreditAsOfBackfillJobStatus(accountId, {
                    dbClient: db,
                });
            }

            const daysDone = baseDone + i + 1;
            await db.$executeRaw`
                UPDATE "CreditAsOfBackfillJob"
                SET checkpoint_date = ${day},
                    days_done = ${daysDone},
                    last_error = NULL,
                    updated_at = ${now}
                WHERE account_id = ${accountId}
                  AND status = 'running'
            `;
        }

        await db.$executeRaw`
            UPDATE "CreditAsOfBackfillJob"
            SET status = 'complete',
                days_done = days_total,
                last_error = NULL,
                updated_at = ${now}
            WHERE account_id = ${accountId}
              AND status = 'running'
        `;
        return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
    } finally {
        runnersInFlight.delete(accountId);
    }
}

function kickRunner(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        writers?: Partial<BackfillWriters>;
        loadAsOfLines?: LoadAsOfLines;
    }
): void {
    void runCreditAsOfBackfillJob(accountId, options).catch(() => {
        /* status persisted on failure inside runner */
    });
}

export async function startCreditAsOfBackfillJob(
    accountId: number,
    fromDate: Date,
    toDate: Date,
    options?: {
        requestedBy?: string | null;
        skipReportingBreach?: boolean;
        dbClient?: PrismaClientLike;
        writers?: Partial<BackfillWriters>;
        loadAsOfLines?: LoadAsOfLines;
        runInline?: boolean;
    }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? prisma;
    const from = toUtcDayStart(fromDate);
    const to = toUtcDayStart(toDate);
    if (to.getTime() < from.getTime()) {
        throw new Error("to_date must be on or after from_date");
    }
    const now = new Date();
    const daysTotal = countInclusiveUtcDays(from, to);
    const skipReportingBreach = options?.skipReportingBreach !== false;
    skipReportingBreachByAccount.set(accountId, skipReportingBreach);
    const existing = await loadJob(accountId, db);
    if (existing && isAdminBackfillBlockingDrain(existing.status)) {
        throw new CreditAsOfBackfillConflictError(
            "A snapshot generate job is already running or paused for this account"
        );
    }

    await db.$executeRaw`
        INSERT INTO "CreditAsOfBackfillJob" (
            account_id,
            status,
            from_date,
            to_date,
            checkpoint_date,
            days_total,
            days_done,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        ) VALUES (
            ${accountId},
            'running',
            ${from},
            ${to},
            NULL,
            ${daysTotal},
            0,
            NULL,
            ${options?.requestedBy ?? null},
            ${now},
            ${now},
            ${now}
        )
        ON CONFLICT (account_id) DO UPDATE SET
            status = 'running',
            from_date = EXCLUDED.from_date,
            to_date = EXCLUDED.to_date,
            checkpoint_date = NULL,
            days_total = EXCLUDED.days_total,
            days_done = 0,
            last_error = NULL,
            requested_by = EXCLUDED.requested_by,
            started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at
    `;

    if (options?.runInline) {
        return runCreditAsOfBackfillJob(accountId, {
            dbClient: db,
            writers: options.writers,
            loadAsOfLines: options.loadAsOfLines,
            now,
        });
    }
    kickRunner(accountId, {
        dbClient: db,
        writers: options?.writers,
        loadAsOfLines: options?.loadAsOfLines,
    });
    return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
}

export async function pauseCreditAsOfBackfillJob(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? prisma;
    const now = new Date();
    const existing = await loadJob(accountId, db);
    if (!existing || existing.status !== "running") {
        return jobView(existing, accountId);
    }
    await db.$executeRaw`
        UPDATE "CreditAsOfBackfillJob"
        SET status = 'paused', updated_at = ${now}
        WHERE account_id = ${accountId}
          AND status = 'running'
    `;
    return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
}

export async function retryCreditAsOfBackfillJob(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        writers?: Partial<BackfillWriters>;
        loadAsOfLines?: LoadAsOfLines;
        runInline?: boolean;
    }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? prisma;
    const now = new Date();
    const existing = await loadJob(accountId, db);
    if (!existing || existing.from_date == null || existing.to_date == null) {
        throw new Error("No backfill job to retry");
    }
    if (existing.status === "running") {
        throw new CreditAsOfBackfillConflictError(
            "A snapshot generate job is already running for this account"
        );
    }
    if (existing.status !== "paused" && existing.status !== "failed") {
        throw new Error(
            "Retry is only available when the job is paused or failed"
        );
    }

    await db.$executeRaw`
        UPDATE "CreditAsOfBackfillJob"
        SET status = 'running',
            last_error = NULL,
            updated_at = ${now}
        WHERE account_id = ${accountId}
    `;

    if (options?.runInline) {
        return runCreditAsOfBackfillJob(accountId, {
            dbClient: db,
            writers: options.writers,
            loadAsOfLines: options.loadAsOfLines,
            now,
        });
    }
    kickRunner(accountId, {
        dbClient: db,
        writers: options?.writers,
        loadAsOfLines: options?.loadAsOfLines,
    });
    return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
}

/** Exported for tests — clear in-process runner guard. */
export function __resetCreditAsOfBackfillRunnersForTests(): void {
    runnersInFlight.clear();
    skipReportingBreachByAccount.clear();
}
