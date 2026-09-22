import type { PrismaClient } from "@prisma/client";
import {
    bindCreditInsurancePrisma,
    startOfTodayUtc,
    syncCustomerPolicyTrendSnapshotForAccount,
} from "@archaser/credit-insurance-domain";

/** Max missing CTP days processed after one successful billing sync. */
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
 * UTC dates to write for post-sync CTP catch-up: day after last successful
 * snapshot through today (inclusive), capped at {@link POST_SYNC_CTP_CATCH_UP_MAX_DAYS}.
 * No prior history → today only.
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
 * True when an accepted in-process billing sync should trigger CTP catch-up.
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
    todayUtc?: Date;
    onLog?: (message: string) => void;
    onError?: (message: string) => void;
    /** Emits Backfill progress `_ctp` while the sync is still RUNNING. */
    onStep?: (state: CtpCatchUpStepState) => void;
    /** Test seam — defaults to domain CTP writer. */
    syncSnapshot?: SyncCustomerPolicyTrendSnapshotFn;
    /** Test seam — defaults to bindCreditInsurancePrisma. */
    bindPrisma?: (prisma: PrismaClient) => void;
    /**
     * Intentionally unused production path — present so tests can assert we do
     * not invoke Portfolio Health / dashboard snapshot backfill.
     */
    takeDashboardSnapshots?: (accountId: number) => Promise<unknown>;
};

function emitStep(
    onStep: MaybeRunPostSyncCtpCatchUpParams["onStep"],
    state: CtpCatchUpStepState
): void {
    onStep?.(state);
}

/**
 * After a successful accepted incremental/backfill sync, catch up missing CTP
 * days for the account. Never throws — CTP failure must not change sync status.
 * When `onStep` is provided, emits running/done/failed for Backfill progress.
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
        syncSnapshot = syncCustomerPolicyTrendSnapshotForAccount,
        bindPrisma = bindCreditInsurancePrisma,
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

        const latest = await prisma.customerPolicyTrend.findFirst({
            where: { account_id: accountId },
            orderBy: { snapshot_date: "desc" },
            select: { snapshot_date: true },
        });

        const todayUtc = params.todayUtc ?? startOfTodayUtc();
        const dates = resolveCtpCatchUpDates({
            lastSnapshotDate: latest?.snapshot_date ?? null,
            todayUtc,
        });
        if (dates.length === 0) {
            emitStep(onStep, {
                status: "done",
                processed: 0,
                total: 0,
                detail: { step: "ctp", processed: 0, total: 0 },
            });
            return;
        }

        const total = dates.length;
        emitStep(onStep, {
            status: "running",
            processed: 0,
            total,
            detail: { step: "ctp", processed: 0, total },
        });
        bindPrisma(prisma);
        onLog?.(
            `CTP catch-up starting for account ${accountId} (${total} day(s))`
        );

        let processed = 0;
        for (const snapshotDate of dates) {
            await syncSnapshot(accountId, { snapshotDate });
            processed += 1;
            emitStep(onStep, {
                status: "running",
                processed,
                total,
                detail: { step: "ctp", processed, total },
            });
        }

        emitStep(onStep, {
            status: "done",
            processed: total,
            total,
            detail: { step: "ctp", processed: total, total },
        });
        onLog?.(
            `CTP catch-up finished for account ${accountId} (${total} day(s))`
        );
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitStep(onStep, {
            status: "failed",
            error: message,
            detail: { step: "ctp" },
        });
        onError?.(
            `[account ${accountId}] CTP catch-up failed after billing sync SUCCESS: ${message}`
        );
    }
}
