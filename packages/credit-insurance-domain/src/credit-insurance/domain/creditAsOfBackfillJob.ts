import { PrismaClient } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import {
    deriveAsOfOpenInvoiceCandidatesFromLedger,
    loadAsOfOpenInvoiceLedgerRange,
} from "./asOfOpenArLedgerPreload";
import { isAdminBackfillBlockingDrain, resolveRewriteDrainStart } from "./asOfRewriteQueue";
import type { AsOfOpenInvoiceLine } from "./asOfOpenAr";
import {
    buildCreditAsOfBackfillRunContext,
    createMinimalCreditAsOfBackfillRunContext,
    ensureCapacityGapsForBackfillRun,
    type CreditAsOfBackfillRunContext,
} from "./creditAsOfBackfillRunContext";
import { takeCreditDashboardDailySnapshotsForAccount } from "./creditDashboardSnapshotService";
import { syncCustomerPolicyTrendSnapshotForAccount, seedPriorDayTrendCostCacheForReplay } from "./customerPolicyTrendService";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";

type PrismaClientLike = PrismaClient | DbClient;

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
    avgSecondsPerDay: number | null;
    estimatedSecondsRemaining: number | null;
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
    skip_reporting_breach: boolean;
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

const CHECKPOINT_MIN_INTERVAL_MS = readEnvInt(
    "CREDIT_ASOF_BACKFILL_CHECKPOINT_MIN_INTERVAL_MS",
    5000,
    1000,
    60_000
);
const CHECKPOINT_MIN_DAYS = readEnvInt(
    "CREDIT_ASOF_BACKFILL_CHECKPOINT_MIN_DAYS",
    1,
    1,
    30
);

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

function computeRunEstimates(row: JobRow): {
    avgSecondsPerDay: number | null;
    estimatedSecondsRemaining: number | null;
} {
    const daysDone = Number(row.days_done ?? 0);
    const daysTotal = Number(row.days_total ?? 0);
    if (
        row.status !== "running" ||
        !row.started_at ||
        daysDone <= 0 ||
        daysTotal <= daysDone
    ) {
        return { avgSecondsPerDay: null, estimatedSecondsRemaining: null };
    }
    const elapsedSec = Math.max(
        0,
        (Date.now() - row.started_at.getTime()) / 1000
    );
    const avgSecondsPerDay = elapsedSec / daysDone;
    const remainingDays = daysTotal - daysDone;
    return {
        avgSecondsPerDay: Math.round(avgSecondsPerDay * 10) / 10,
        estimatedSecondsRemaining: Math.round(
            avgSecondsPerDay * remainingDays
        ),
    };
}

function jobView(row: JobRow | null): CreditAsOfBackfillJobView {
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
            skipReportingBreach: true,
            avgSecondsPerDay: null,
            estimatedSecondsRemaining: null,
        };
    }
    const estimates = computeRunEstimates(row);
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
        skipReportingBreach: row.skip_reporting_breach !== false,
        avgSecondsPerDay: estimates.avgSecondsPerDay,
        estimatedSecondsRemaining: estimates.estimatedSecondsRemaining,
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
            skip_reporting_breach,
            started_at,
            updated_at
        FROM "CreditAsOfBackfillJob"
        WHERE account_id = ${accountId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function listRunningCreditAsOfBackfillAccountIds(
    options?: { dbClient?: PrismaClientLike }
): Promise<number[]> {
    const db = options?.dbClient ?? defaultPrisma;
    const rows = await db.$queryRaw<{ account_id: number }[]>`
        SELECT account_id
        FROM "CreditAsOfBackfillJob"
        WHERE status = 'running'
    `;
    return rows.map((row) => Number(row.account_id));
}

export async function getCreditAsOfBackfillJobStatus(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    return jobView(await loadJob(accountId, db));
}

export class CreditAsOfBackfillConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CreditAsOfBackfillConflictError";
    }
}

const runnersInFlight = new Set<number>();

type AsOfLines = AsOfOpenInvoiceLine[];

type BackfillRunContext = CreditAsOfBackfillRunContext;

type BackfillWriters = {
    syncCustomerPolicyTrendSnapshotForAccount: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: AsOfLines;
            ignoreReportingBreach?: boolean;
            mepBreachStartDate?: Date | null;
            runContext?: BackfillRunContext;
        }
    ) => Promise<unknown>;
    takeCreditDashboardDailySnapshotsForAccount: (
        accountId: number,
        options: {
            snapshotDate: Date;
            asOfLines?: AsOfLines;
            ignoreReportingBreach?: boolean;
            runContext?: BackfillRunContext;
        }
    ) => Promise<{ scopesProcessed: number } | unknown>;
};

type LoadAsOfLines = (
    accountId: number,
    asOfDate: Date
) => Promise<AsOfLines>;

type CreditAsOfBackfillDispatch = (
    accountId: number
) => Promise<{ queued: boolean; reason?: string }>;

let creditAsOfBackfillDispatch: CreditAsOfBackfillDispatch | null = null;

/** API worker host registers BullMQ enqueue; tests omit and use runInline. */
export function registerCreditAsOfBackfillDispatch(
    dispatch: CreditAsOfBackfillDispatch | null
): void {
    creditAsOfBackfillDispatch = dispatch;
}

/** BullMQ custom job id (colons are invalid). One queue job per account. */
export function creditAsOfBackfillBullJobId(accountId: number): string {
    return `credit-asof-backfill-${accountId}`;
}

async function dispatchRunner(accountId: number): Promise<void> {
    if (creditAsOfBackfillDispatch) {
        const result = await creditAsOfBackfillDispatch(accountId);
        if (result.queued) {
            return;
        }
    }
    void runCreditAsOfBackfillJob(accountId).catch(() => {});
}

async function resolveWriters(
    writers?: Partial<BackfillWriters>
): Promise<BackfillWriters> {
    return {
        syncCustomerPolicyTrendSnapshotForAccount:
            writers?.syncCustomerPolicyTrendSnapshotForAccount ??
            syncCustomerPolicyTrendSnapshotForAccount,
        takeCreditDashboardDailySnapshotsForAccount:
            writers?.takeCreditDashboardDailySnapshotsForAccount ??
            takeCreditDashboardDailySnapshotsForAccount,
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
    const db = options?.dbClient ?? defaultPrisma;
    const now = options?.now ?? new Date();
    try {
        const writers = await resolveWriters(options?.writers);
        let job = await loadJob(accountId, db);
        if (!job || job.from_date == null || job.to_date == null) {
            return jobView(job);
        }
        if (job.status !== "running") {
            return jobView(job);
        }

        await db.$executeRaw`
            UPDATE "CreditAsOfBackfillJob"
            SET updated_at = ${now}
            WHERE account_id = ${accountId}
              AND status = 'running'
        `;

        const resumeFrom = resolveRewriteDrainStart(
            job.from_date,
            job.checkpoint_date
        );

        let runContext: BackfillRunContext;
        if (options?.loadAsOfLines) {
            const mepBreachStartDate = await resolveMepBreachStartDate(
                accountId,
                db
            );
            runContext = createMinimalCreditAsOfBackfillRunContext(
                accountId,
                mepBreachStartDate
            );
        } else {
            runContext = await buildCreditAsOfBackfillRunContext(accountId, {
                dbClient: db,
                replayFromDate: job.from_date,
                replayToDate: job.to_date,
            });
            runContext = await ensureCapacityGapsForBackfillRun(runContext, {
                dbClient: db,
            });
            if (resumeFrom.getTime() > job.from_date.getTime()) {
                runContext.priorDayTrendCostByKey =
                    await seedPriorDayTrendCostCacheForReplay(
                        accountId,
                        resumeFrom
                    );
            }
        }

        const days = enumerateUtcDaysInclusive(resumeFrom, job.to_date);
        const baseDone = Math.max(
            0,
            countInclusiveUtcDays(job.from_date, job.to_date) - days.length
        );

        let loadAsOfLines: LoadAsOfLines;
        if (options?.loadAsOfLines) {
            loadAsOfLines = options.loadAsOfLines;
        } else {
            const ledger = await loadAsOfOpenInvoiceLedgerRange(
                accountId,
                job.to_date,
                { dbClient: db }
            );
            loadAsOfLines = async (_id, asOfDate) =>
                deriveAsOfOpenInvoiceCandidatesFromLedger(ledger, asOfDate);
        }

        const ignoreReportingBreach = job.skip_reporting_breach !== false;

        let pendingCheckpoint: {
            checkpointDate: Date;
            daysDone: number;
        } | null = null;
        let lastCheckpointFlushAt = 0;
        let daysSinceLastCheckpointFlush = 0;

        async function flushCheckpoint(force: boolean): Promise<void> {
            if (!pendingCheckpoint) {
                return;
            }
            const elapsedMs = Date.now() - lastCheckpointFlushAt;
            const shouldFlush =
                force ||
                lastCheckpointFlushAt === 0 ||
                elapsedMs >= CHECKPOINT_MIN_INTERVAL_MS ||
                daysSinceLastCheckpointFlush >= CHECKPOINT_MIN_DAYS;
            if (!shouldFlush) {
                return;
            }
            await db.$executeRaw`
                UPDATE "CreditAsOfBackfillJob"
                SET checkpoint_date = ${pendingCheckpoint.checkpointDate},
                    days_done = ${pendingCheckpoint.daysDone},
                    last_error = NULL,
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND status = 'running'
            `;
            lastCheckpointFlushAt = Date.now();
            daysSinceLastCheckpointFlush = 0;
        }

        for (let i = 0; i < days.length; i++) {
            const day = days[i]!;
            const latest = await loadJob(accountId, db);
            if (!latest || latest.status !== "running") {
                await flushCheckpoint(true);
                return jobView(latest);
            }

            try {
                const asOfLines = await loadAsOfLines(accountId, day);
                await writers.syncCustomerPolicyTrendSnapshotForAccount(
                    accountId,
                    {
                        snapshotDate: day,
                        asOfLines,
                        ignoreReportingBreach,
                        mepBreachStartDate: runContext.mepBreachStartDate,
                        runContext,
                    }
                );
                await writers.takeCreditDashboardDailySnapshotsForAccount(
                    accountId,
                    {
                        snapshotDate: day,
                        asOfLines,
                        ignoreReportingBreach,
                        runContext,
                    }
                );
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);
                await flushCheckpoint(true);
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
            pendingCheckpoint = { checkpointDate: day, daysDone };
            daysSinceLastCheckpointFlush += 1;
            await flushCheckpoint(i === days.length - 1);
        }

        await flushCheckpoint(true);
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
    const db = options?.dbClient ?? defaultPrisma;
    const from = toUtcDayStart(fromDate);
    const to = toUtcDayStart(toDate);
    if (to.getTime() < from.getTime()) {
        throw new Error("to_date must be on or after from_date");
    }
    const now = new Date();
    const daysTotal = countInclusiveUtcDays(from, to);
    const skipReportingBreach = options?.skipReportingBreach !== false;
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
            skip_reporting_breach,
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
            ${skipReportingBreach},
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
            skip_reporting_breach = EXCLUDED.skip_reporting_breach,
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
    await dispatchRunner(accountId);
    return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
}

export async function pauseCreditAsOfBackfillJob(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    const now = new Date();
    const existing = await loadJob(accountId, db);
    if (!existing || existing.status !== "running") {
        return jobView(existing);
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
    const db = options?.dbClient ?? defaultPrisma;
    const now = new Date();
    const existing = await loadJob(accountId, db);
    if (!existing || existing.from_date == null || existing.to_date == null) {
        throw new Error("No backfill job to retry");
    }
    if (existing.status === "running") {
        await db.$executeRaw`
            UPDATE "CreditAsOfBackfillJob"
            SET updated_at = ${now}
            WHERE account_id = ${accountId}
              AND status = 'running'
        `;
        await dispatchRunner(accountId);
        return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
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
    await dispatchRunner(accountId);
    return getCreditAsOfBackfillJobStatus(accountId, { dbClient: db });
}

/** Exported for tests — clear in-process runner guard. */
export function __resetCreditAsOfBackfillRunnersForTests(): void {
    runnersInFlight.clear();
    creditAsOfBackfillDispatch = null;
}
