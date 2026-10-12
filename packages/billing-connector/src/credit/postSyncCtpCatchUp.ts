import type { PrismaClient } from "@prisma/client";
import {
    CreditAsOfBackfillConflictError,
    getPendingAsOfRewriteWindow,
    startCreditAsOfBackfillJob,
} from "@archaser/credit-insurance-domain";

/**
 * @deprecated Tip CTP fill was replaced by starting Portfolio Health Generate
 * for the pending as-of rewrite window. Kept for export compatibility.
 */
export const POST_SYNC_CTP_CATCH_UP_MAX_DAYS = 30;

/** Progress callback for Backfill progress `_ctp` tail step (soft-fail only). */
export type CtpCatchUpStepState = {
    status: "running" | "done" | "failed";
    processed?: number;
    total?: number;
    error?: string;
    detail?: {
        step: string;
        processed?: number;
        total?: number;
    };
};

function startOfUtcDay(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function addUtcCalendarDays(base: Date, days: number): Date {
    const d = new Date(base.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function utcCalendarDaysBetween(start: Date, end: Date): number {
    const startDay = startOfUtcDay(start);
    const endDay = startOfUtcDay(end);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((endDay.getTime() - startDay.getTime()) / msPerDay);
}

/**
 * @deprecated Prefer the pending rewrite window + Generate start. Kept for
 * callers/tests that still assert tip-fill date math.
 */
export function resolveCtpCatchUpDates(args: {
    lastSnapshotDate: Date | null;
    todayUtc: Date;
    maxDays?: number;
}): Date[] {
    const maxDays = args.maxDays ?? POST_SYNC_CTP_CATCH_UP_MAX_DAYS;
    const today = startOfUtcDay(args.todayUtc);

    if (args.lastSnapshotDate == null) {
        return [today];
    }

    const lastDate = startOfUtcDay(args.lastSnapshotDate);
    const firstMissing = addUtcCalendarDays(lastDate, 1);

    if (firstMissing.getTime() > today.getTime()) {
        return [];
    }

    const gapDays = utcCalendarDaysBetween(firstMissing, today) + 1;
    const fillStart =
        gapDays > maxDays
            ? addUtcCalendarDays(today, -(maxDays - 1))
            : firstMissing;

    const dates: Date[] = [];
    for (
        let cursor = new Date(fillStart.getTime());
        cursor.getTime() <= today.getTime();
        cursor = addUtcCalendarDays(cursor, 1)
    ) {
        dates.push(new Date(cursor.getTime()));
    }
    return dates;
}

function normalizeSyncMode(mode: string | undefined | null): string {
    return (mode ?? "").trim().toLowerCase();
}

/**
 * True when an accepted in-process billing sync should start Portfolio Health
 * Generate for the pending as-of rewrite window (import-touched days).
 */
export function shouldRunPostSyncCtpCatchUp(args: {
    mode: string;
    status: string;
    postIngestDeferred?: boolean;
}): boolean {
    if (args.postIngestDeferred) {
        return false;
    }
    if (args.status !== "SUCCESS") {
        return false;
    }
    const mode = normalizeSyncMode(args.mode);
    return mode === "incremental" || mode === "backfill";
}

export type StartPortfolioGenerateFn = (
    accountId: number,
    fromDate: Date,
    toDate: Date,
    options?: { requestedBy?: string | null; runInline?: boolean }
) => Promise<unknown>;

export type GetPendingRewriteWindowFn = (
    accountId: number
) => Promise<{ fromDate: Date; toDate: Date } | null>;

/** @deprecated Tip CTP writer seam — unused by the Generate-start path. */
export type SyncCustomerPolicyTrendSnapshotFn = (
    accountId: number,
    options?: { snapshotDate?: Date }
) => Promise<number>;

export type MaybeRunPostSyncCtpCatchUpParams = {
    prisma: PrismaClient;
    accountId: number;
    mode: string;
    status: string;
    postIngestDeferred?: boolean;
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
    /** Emits Backfill progress `_ctp` while the sync is still RUNNING. */
    onStep?: (state: CtpCatchUpStepState) => void;
    /** Test seam — defaults to {@link startCreditAsOfBackfillJob}. */
    startGenerate?: StartPortfolioGenerateFn;
    /** Test seam — defaults to {@link getPendingAsOfRewriteWindow}. */
    getPendingWindow?: GetPendingRewriteWindowFn;
    /**
     * Intentionally unused — present so tests can assert we do not invoke
     * dashboard writers inline inside the sync (Generate runs async).
     */
    takeDashboardSnapshots?: (accountId: number) => Promise<unknown>;
    /** @deprecated Tip CTP path removed; ignored. */
    syncSnapshot?: SyncCustomerPolicyTrendSnapshotFn;
    /** @deprecated Tip CTP path removed; ignored. */
    bindPrisma?: (prisma: PrismaClient) => void;
    /** @deprecated Tip CTP path removed; ignored. */
    todayUtc?: Date;
};

function emitStep(
    onStep: MaybeRunPostSyncCtpCatchUpParams["onStep"],
    state: CtpCatchUpStepState
): void {
    onStep?.(state);
}

function countInclusiveUtcDays(from: Date, to: Date): number {
    return utcCalendarDaysBetween(from, to) + 1;
}

/**
 * After a successful accepted incremental/backfill sync, start Portfolio Health
 * Generate for the pending as-of rewrite window (min import entity date → today).
 * That covers all days touched by a backfill without blocking sync finalize.
 * Never throws — Generate failure / conflict must not change sync status.
 */
export async function maybeRunPostSyncCtpCatchUp(
    params: MaybeRunPostSyncCtpCatchUpParams
): Promise<void> {
    if (
        !shouldRunPostSyncCtpCatchUp({
            mode: params.mode,
            status: params.status,
            postIngestDeferred: params.postIngestDeferred,
        })
    ) {
        return;
    }

    const {
        prisma,
        accountId,
        onLog,
        onError,
        onStep,
        startGenerate = (id, from, to, options) =>
            startCreditAsOfBackfillJob(id, from, to, {
                requestedBy: options?.requestedBy,
                runInline: options?.runInline ?? false,
                dbClient: prisma,
            }),
        getPendingWindow = (id) => getPendingAsOfRewriteWindow(id, prisma),
    } = params;

    try {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { has_credit_insurance: true },
        });
        if (account?.has_credit_insurance !== true) {
            emitStep(onStep, {
                status: "done",
                processed: 0,
                total: 0,
                detail: { step: "ctp", processed: 0, total: 0 },
            });
            return;
        }

        const pending = await getPendingWindow(accountId);
        if (pending == null) {
            emitStep(onStep, {
                status: "done",
                processed: 0,
                total: 0,
                detail: { step: "ctp", processed: 0, total: 0 },
            });
            onLog?.(
                `Portfolio Generate skipped for account ${accountId} (no pending rewrite window)`
            );
            return;
        }

        const total = countInclusiveUtcDays(pending.fromDate, pending.toDate);
        emitStep(onStep, {
            status: "running",
            processed: 0,
            total,
            detail: { step: "ctp", processed: 0, total },
        });
        onLog?.(
            `Portfolio Generate starting for account ${accountId} (${total} day(s), ${pending.fromDate.toISOString().slice(0, 10)} – ${pending.toDate.toISOString().slice(0, 10)})`
        );

        await startGenerate(accountId, pending.fromDate, pending.toDate, {
            requestedBy: "billing-sync-post-success",
            runInline: false,
        });

        emitStep(onStep, {
            status: "done",
            processed: total,
            total,
            detail: { step: "ctp", processed: total, total },
        });
        onLog?.(
            `Portfolio Generate queued for account ${accountId} (${total} day(s))`
        );
    } catch (error) {
        if (error instanceof CreditAsOfBackfillConflictError) {
            emitStep(onStep, {
                status: "done",
                detail: { step: "ctp" },
            });
            onLog?.(
                `[account ${accountId}] Portfolio Generate already running — left in place after billing sync SUCCESS`
            );
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        emitStep(onStep, {
            status: "failed",
            error: message,
            detail: { step: "ctp" },
        });
        onError?.(
            `[account ${accountId}] Portfolio Generate failed to start after billing sync SUCCESS: ${message}`
        );
    }
}
