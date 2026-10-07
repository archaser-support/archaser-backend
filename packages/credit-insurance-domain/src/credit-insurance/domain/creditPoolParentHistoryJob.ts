/**
 * Scoped credit-history refresh after parent_customer_id changes.
 *
 * Rewrites CTP only for affected pool member IDs over the AR date window, then
 * one bulk pool overlay. Does **not** rewrite Credit Dashboard Daily Snapshot
 * history — today CDP stays on the parent-save sync path; chart history catches
 * up via overnight / Portfolio Health Generate.
 *
 * Performance: ledger preload, in-memory prior-day CTP cost cache, shared terms
 * overlay, batched checkpoints, bulk overlay after all CTP days.
 */
import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import { ACCOUNT_BACKGROUND_JOB_KIND } from "./accountBackgroundJob";
import {
    countInclusiveUtcDays,
    enumerateUtcDaysInclusive,
    type CreditAsOfBackfillJobView,
    type CreditAsOfBackfillStatus,
} from "./creditAsOfBackfillJob";
import {
    generateStatusBlocksParentHistory,
    loadCreditAsOfBackfillLease,
} from "./accountBackgroundJobLease";
import {
    CreditPoolParentHistoryConflictError,
    enrichParentHistoryJobView,
} from "./creditPoolParentChangeProgress";
import {
    elapsedMsSince,
} from "./creditPoolParentChangeTiming";
import { customerIdsWithChildren } from "./creditPoolShellGuards";
import { createCreditPoolMembershipCache } from "./parentCustomerCreditInheritance";
import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";

export { CreditPoolParentHistoryConflictError };

const PARENT_HISTORY_JOB_KIND =
    ACCOUNT_BACKGROUND_JOB_KIND.CREDIT_POOL_PARENT_HISTORY;

const CHECKPOINT_MIN_INTERVAL_MS = 5_000;
const CHECKPOINT_MIN_DAYS = 5;

type PrismaClientLike = DbClient;

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
    run_token: string | null;
};

type ScopedRunPayload = {
    runToken: string;
    customerIds: number[];
    skipPoolTrendOverlay: boolean;
};

const pendingPayloadByAccount = new Map<number, ScopedRunPayload>();
const runnersInFlight = new Set<number>();

function toYmd(date: Date | null | undefined): string | null {
    if (!date) {
        return null;
    }
    return toUtcDateOnly(date).toISOString().slice(0, 10);
}

function normalizeStatus(
    raw: string | null | undefined
): CreditAsOfBackfillStatus {
    if (
        raw === "syncing" ||
        raw === "running" ||
        raw === "paused" ||
        raw === "failed" ||
        raw === "complete"
    ) {
        return raw;
    }
    return "idle";
}

function jobView(row: JobRow | null): CreditAsOfBackfillJobView {
    if (!row) {
        return enrichParentHistoryJobView(
            {
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
                avgSecondsPerDay: null,
                estimatedSecondsRemaining: null,
                pendingRewrite: null,
            },
            null,
            null
        );
    }
    const daysTotal = Number(row.days_total ?? 0);
    const daysDone = Number(row.days_done ?? 0);
    const status = normalizeStatus(row.status);
    let avgSecondsPerDay: number | null = null;
    let estimatedSecondsRemaining: number | null = null;
    if (
        status === "running" &&
        row.started_at != null &&
        daysDone > 0 &&
        daysTotal > daysDone
    ) {
        const elapsedSec =
            (Date.now() - new Date(row.started_at).getTime()) / 1000;
        avgSecondsPerDay = elapsedSec / daysDone;
        estimatedSecondsRemaining =
            avgSecondsPerDay * (daysTotal - daysDone);
    }
    return enrichParentHistoryJobView(
        {
            status,
            fromDate: toYmd(row.from_date),
            toDate: toYmd(row.to_date),
            checkpointDate: toYmd(row.checkpoint_date),
            daysTotal,
            daysDone,
            lastError: row.last_error,
            requestedBy: row.requested_by,
            startedAt: row.started_at?.toISOString() ?? null,
            updatedAt: row.updated_at?.toISOString() ?? null,
            avgSecondsPerDay,
            estimatedSecondsRemaining,
            pendingRewrite: null,
        },
        row.run_token,
        row.status
    );
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
            units_total AS days_total,
            units_done AS days_done,
            last_error,
            requested_by,
            started_at,
            updated_at,
            run_token
        FROM "AccountBackgroundJob"
        WHERE account_id = ${accountId}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function getCreditPoolParentHistoryJobStatus(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    return jobView(await loadJob(accountId, db));
}

async function dispatchRunner(accountId: number): Promise<void> {
    void runCreditPoolParentHistoryJob(accountId).catch((error) => {
        console.error("[CreditPoolParentHistory] inline runner failed", {
            accountId,
            errorMessage:
                error instanceof Error ? error.message : String(error),
        });
    });
}

/**
 * Start scoped CTP history rewrite for pool members (not account Generate).
 * CDP history is intentionally omitted — see module doc.
 */
export async function startCreditPoolParentHistoryJob(args: {
    accountId: number;
    customerIds: readonly number[];
    fromDate: Date;
    toDate: Date;
    requestedBy?: string | null;
    dbClient?: PrismaClientLike;
    skipPoolTrendOverlay?: boolean;
}): Promise<CreditAsOfBackfillJobView> {
    const db = args.dbClient ?? defaultPrisma;
    const customerIds = [...new Set(args.customerIds)].filter(Number.isFinite);
    if (customerIds.length === 0) {
        return getCreditPoolParentHistoryJobStatus(args.accountId, {
            dbClient: db,
        });
    }
    const from = toUtcDateOnly(args.fromDate);
    const to = toUtcDateOnly(args.toDate);
    if (to.getTime() < from.getTime()) {
        return getCreditPoolParentHistoryJobStatus(args.accountId, {
            dbClient: db,
        });
    }

    const existing = await loadJob(args.accountId, db);
    const generateLease = await loadCreditAsOfBackfillLease(args.accountId, db);
    if (
        generateStatusBlocksParentHistory(
            generateLease?.status,
            generateLease?.updated_at
        )
    ) {
        throw new CreditPoolParentHistoryConflictError(
            "A snapshot generate job is already running for this account"
        );
    }
    // `syncing` is the same Save request handing off to history — allow.
    if (
        existing?.status === "running" ||
        existing?.status === "paused"
    ) {
        throw new CreditPoolParentHistoryConflictError();
    }

    const now = new Date();
    const daysTotal = countInclusiveUtcDays(from, to);
    const runToken = `${now.getTime()}-${customerIds.length}`;

    pendingPayloadByAccount.set(args.accountId, {
        runToken,
        customerIds,
        skipPoolTrendOverlay: args.skipPoolTrendOverlay === true,
    });

    await db.$executeRaw`
        INSERT INTO "AccountBackgroundJob" (
            account_id,
            job_kind,
            status,
            from_date,
            to_date,
            checkpoint_date,
            units_total,
            units_done,
            run_token,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        ) VALUES (
            ${args.accountId},
            ${PARENT_HISTORY_JOB_KIND},
            'running',
            ${from},
            ${to},
            NULL,
            ${daysTotal},
            0,
            ${runToken},
            NULL,
            ${args.requestedBy ?? null},
            ${now},
            ${now},
            ${now}
        )
        ON CONFLICT (account_id, job_kind) DO UPDATE SET
            status = 'running',
            from_date = EXCLUDED.from_date,
            to_date = EXCLUDED.to_date,
            checkpoint_date = NULL,
            units_total = EXCLUDED.units_total,
            units_done = 0,
            run_token = EXCLUDED.run_token,
            last_error = NULL,
            requested_by = EXCLUDED.requested_by,
            started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at
    `;

    await dispatchRunner(args.accountId);
    return getCreditPoolParentHistoryJobStatus(args.accountId, {
        dbClient: db,
    });
}

export async function runCreditPoolParentHistoryJob(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<CreditAsOfBackfillJobView> {
    if (runnersInFlight.has(accountId)) {
        return getCreditPoolParentHistoryJobStatus(accountId, options);
    }
    runnersInFlight.add(accountId);
    const db = options?.dbClient ?? defaultPrisma;
    const startedMs = Date.now();
    try {
        const job = await loadJob(accountId, db);
        if (!job || job.from_date == null || job.to_date == null) {
            return jobView(job);
        }
        if (job.status !== "running") {
            return jobView(job);
        }

        const payload = pendingPayloadByAccount.get(accountId);
        if (
            payload == null ||
            payload.runToken !== (job.run_token ?? null) ||
            payload.customerIds.length === 0
        ) {
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET status = 'failed',
                    last_error = ${"Missing scoped customer payload for parent history job"},
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${PARENT_HISTORY_JOB_KIND}
                  AND status = 'running'
            `;
            return getCreditPoolParentHistoryJobStatus(accountId, {
                dbClient: db,
            });
        }

        const from = toUtcDateOnly(job.from_date);
        const to = toUtcDateOnly(job.to_date);
        const days = enumerateUtcDaysInclusive(from, to);
        const memberIdSet = new Set(payload.customerIds);
        const cache = createCreditPoolMembershipCache();
        const shellIds = payload.skipPoolTrendOverlay
            ? new Set<number>()
            : await customerIdsWithChildren(payload.customerIds, db);

        const {
            syncCustomerPolicyTrendSnapshotForAccount,
            seedPriorDayTrendCostCacheForReplay,
        } = await import("./customerPolicyTrendService");
        const {
            buildCreditAsOfBackfillRunContext,
            buildAsOfTermsMapForDate,
            ensureCapacityGapsForBackfillRun,
        } = await import("./creditAsOfBackfillRunContext");
        const {
            loadAsOfOpenInvoiceLedgerRange,
            deriveAsOfOpenInvoiceCandidatesFromLedger,
        } = await import("./asOfOpenArLedgerPreload");
        const { overlayAsOfTermsFlagsOnLines, isUtcCalendarToday } =
            await import("./asOfOpenAr");

        let runContext = await buildCreditAsOfBackfillRunContext(accountId, {
            dbClient: db,
            customerIds: payload.customerIds,
            replayFromDate: from,
            replayToDate: to,
        });
        runContext = await ensureCapacityGapsForBackfillRun(runContext, {
            dbClient: db,
        });
        // In-memory predecessor costs — same path as Portfolio Health Generate.
        runContext.priorDayTrendCostByKey =
            await seedPriorDayTrendCostCacheForReplay(accountId, from);

        const ledger = await loadAsOfOpenInvoiceLedgerRange(accountId, to, {
            dbClient: db,
        });
        const hasVersionedPolicies =
            runContext.activeCustomerPolicies.length > 0;

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
                UPDATE "AccountBackgroundJob"
                SET units_done = ${pendingCheckpoint.daysDone},
                    checkpoint_date = ${pendingCheckpoint.checkpointDate},
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${PARENT_HISTORY_JOB_KIND}
                  AND status = 'running'
                  AND run_token = ${payload!.runToken}
            `;
            lastCheckpointFlushAt = Date.now();
            daysSinceLastCheckpointFlush = 0;
        }

        let daysDone = 0;
        for (let i = 0; i < days.length; i++) {
            const day = days[i]!;
            if (i === 0 || i % CHECKPOINT_MIN_DAYS === 0) {
                const live = await loadJob(accountId, db);
                if (
                    !live ||
                    live.status !== "running" ||
                    live.run_token !== payload.runToken
                ) {
                    await flushCheckpoint(true);
                    break;
                }
            }

            let asOfLines = deriveAsOfOpenInvoiceCandidatesFromLedger(
                ledger,
                day
            );
            let asOfTermsFlagsApplied = false;
            if (isUtcCalendarToday(day)) {
                asOfTermsFlagsApplied = true;
            } else if (hasVersionedPolicies) {
                asOfLines = overlayAsOfTermsFlagsOnLines(
                    asOfLines,
                    day,
                    buildAsOfTermsMapForDate(
                        runContext.activeCustomerPolicies,
                        day
                    ),
                    {
                        ignoreReportingBreach: false,
                        mepBreachStartDate: runContext.mepBreachStartDate,
                        reportingBreachStartDate:
                            runContext.reportingBreachStartDate,
                    }
                );
                asOfTermsFlagsApplied = true;
            }

            const memberLines = asOfLines.filter((line) =>
                memberIdSet.has(line.customerId)
            );
            await syncCustomerPolicyTrendSnapshotForAccount(accountId, {
                snapshotDate: day,
                customerIds: payload.customerIds,
                asOfLines: memberLines,
                mepBreachStartDate: runContext.mepBreachStartDate,
                runContext,
                asOfTermsFlagsApplied,
            });

            daysDone = i + 1;
            pendingCheckpoint = { checkpointDate: day, daysDone };
            daysSinceLastCheckpointFlush += 1;
            await flushCheckpoint(i === days.length - 1);
        }

        await flushCheckpoint(true);

        // One bulk pool overlay for the whole window (not per-day SQL).
        if (shellIds.size > 0 && daysDone > 0) {
            try {
                const { overlayPoolCapacityGapAndAtRiskOnTrends } =
                    await import(
                        "./syncCreditPoolPolicyTrendsAfterParentChange"
                    );
                await overlayPoolCapacityGapAndAtRiskOnTrends({
                    accountId,
                    rootCustomerIds: [...shellIds],
                    fromDate: from,
                    toDate: to,
                    dbClient: db,
                    cache,
                });
            } catch (overlayError) {
                console.error(
                    "[CreditPoolParentHistory] bulk pool overlay failed",
                    {
                        accountId,
                        errorMessage:
                            overlayError instanceof Error
                                ? overlayError.message
                                : String(overlayError),
                    }
                );
            }
        }

        const final = await loadJob(accountId, db);
        if (
            final?.status === "running" &&
            final.run_token === payload.runToken
        ) {
            const now = new Date();
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET status = 'complete',
                    units_done = ${daysDone},
                    updated_at = ${now}
                WHERE account_id = ${accountId}
                  AND job_kind = ${PARENT_HISTORY_JOB_KIND}
                  AND run_token = ${payload.runToken}
            `;
        }

        pendingPayloadByAccount.delete(accountId);
        return getCreditPoolParentHistoryJobStatus(accountId, {
            dbClient: db,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error("[CreditPoolParentHistory] job failed", {
            accountId,
            errorMessage: message,
            elapsedMs: elapsedMsSince(startedMs),
        });
        await db.$executeRaw`
            UPDATE "AccountBackgroundJob"
            SET status = 'failed',
                last_error = ${message.slice(0, 2000)},
                updated_at = ${new Date()}
            WHERE account_id = ${accountId}
              AND job_kind = ${PARENT_HISTORY_JOB_KIND}
              AND status = 'running'
        `;
        pendingPayloadByAccount.delete(accountId);
        return getCreditPoolParentHistoryJobStatus(accountId, {
            dbClient: db,
        });
    } finally {
        runnersInFlight.delete(accountId);
    }
}

export function __resetCreditPoolParentHistoryRunnersForTests(): void {
    runnersInFlight.clear();
    pendingPayloadByAccount.clear();
}
