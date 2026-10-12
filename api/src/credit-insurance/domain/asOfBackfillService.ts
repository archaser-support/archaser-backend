import {
    ACCOUNT_BACKGROUND_JOB_KIND,
    CreditAsOfBackfillConflictError,
    creditInsurancePrisma as prisma,
    getCreditAsOfBackfillJobStatus,
    pauseCreditAsOfBackfillJob,
    retryCreditAsOfBackfillJob,
    startCreditAsOfBackfillJob,
    startOfTodayUtc,
    type CreditAsOfBackfillJobView,
} from "@archaser/credit-insurance-domain";

const CREDIT_ASOF_JOB_KIND =
    ACCOUNT_BACKGROUND_JOB_KIND.CREDIT_ASOF_BACKFILL;

export type AsOfBackfillStatusValue =
    | "idle"
    | "running"
    | "paused"
    | "failed"
    | "complete";

export type AsOfBackfillStatus = {
    accountId: number;
    status: AsOfBackfillStatusValue;
    fromDate: string | null;
    toDate: string | null;
    lastCheckpoint: string | null;
    daysDone: number;
    daysTotal: number;
    lastError: string | null;
    startedAt: string | null;
    updatedAt: string | null;
};

type BackfillRow = {
    account_id: number;
    status: string;
    from_date: Date | null;
    to_date: Date | null;
    checkpoint_date: Date | null;
    days_total: number;
    days_done: number;
    last_error: string | null;
    started_at: Date | null;
    updated_at: Date | null;
};

function toDayStartUtc(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function dateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function idleStatus(accountId: number): AsOfBackfillStatus {
    return {
        accountId,
        status: "idle",
        fromDate: null,
        toDate: null,
        lastCheckpoint: null,
        daysDone: 0,
        daysTotal: 0,
        lastError: null,
        startedAt: null,
        updatedAt: null,
    };
}

function rowToStatus(row: BackfillRow): AsOfBackfillStatus {
    const status = (
        ["idle", "running", "paused", "failed", "complete"].includes(row.status)
            ? row.status
            : "idle"
    ) as AsOfBackfillStatusValue;
    return {
        accountId: row.account_id,
        status,
        fromDate: dateOnly(row.from_date),
        toDate: dateOnly(row.to_date),
        lastCheckpoint: dateOnly(row.checkpoint_date),
        daysDone: row.days_done,
        daysTotal: row.days_total,
        lastError: row.last_error,
        startedAt: row.started_at?.toISOString() ?? null,
        updatedAt: row.updated_at?.toISOString() ?? null,
    };
}

async function readRow(accountId: number): Promise<BackfillRow | null> {
    const rows = await prisma.$queryRaw<BackfillRow[]>`
        SELECT account_id, status, from_date, to_date, checkpoint_date,
               units_total AS days_total, units_done AS days_done,
               last_error, started_at, updated_at
        FROM "AccountBackgroundJob"
        WHERE account_id = ${accountId}
          AND job_kind = ${CREDIT_ASOF_JOB_KIND}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function getAsOfBackfillStatus(
    accountId: number
): Promise<AsOfBackfillStatus> {
    const row = await readRow(accountId);
    return row ? rowToStatus(row) : idleStatus(accountId);
}

function viewToStatus(
    accountId: number,
    view: CreditAsOfBackfillJobView
): AsOfBackfillStatus {
    const status = (
        ["idle", "running", "paused", "failed", "complete"].includes(view.status)
            ? view.status
            : "idle"
    ) as AsOfBackfillStatusValue;
    return {
        accountId,
        status,
        fromDate: view.fromDate,
        toDate: view.toDate,
        lastCheckpoint: view.checkpointDate,
        daysDone: view.daysDone,
        daysTotal: view.daysTotal,
        lastError: view.lastError,
        startedAt: view.startedAt,
        updatedAt: view.updatedAt,
    };
}

export async function startAsOfBackfill(
    accountId: number,
    requestedBy: string | null
): Promise<AsOfBackfillStatus> {
    const toDate = startOfTodayUtc();
    const agg = await prisma.invoice.aggregate({
        where: { customer_id: { not: null }, Customer: { account_id: accountId } },
        _min: { invoice_date: true },
    });
    const earliest = agg._min.invoice_date;

    if (!earliest) {
        await prisma.$executeRaw`
            INSERT INTO "AccountBackgroundJob" (
                account_id, job_kind, status, from_date, to_date, checkpoint_date,
                units_total, units_done, last_error, requested_by, started_at, updated_at
            ) VALUES (
                ${accountId}, ${CREDIT_ASOF_JOB_KIND}, 'complete', NULL, NULL, NULL, 0, 0, NULL,
                ${requestedBy}, NOW(), NOW()
            )
            ON CONFLICT (account_id, job_kind) DO UPDATE SET
                status = 'complete', from_date = NULL, to_date = NULL,
                checkpoint_date = NULL, units_total = 0, units_done = 0,
                last_error = NULL, requested_by = ${requestedBy},
                started_at = NOW(), updated_at = NOW()
        `;
        return getAsOfBackfillStatus(accountId);
    }

    try {
        const view = await startCreditAsOfBackfillJob(
            accountId,
            toDayStartUtc(earliest),
            toDate,
            { requestedBy }
        );
        return viewToStatus(accountId, view);
    } catch (error) {
        if (error instanceof CreditAsOfBackfillConflictError) {
            return viewToStatus(
                accountId,
                await getCreditAsOfBackfillJobStatus(accountId)
            );
        }
        throw error;
    }
}

export async function pauseAsOfBackfill(
    accountId: number
): Promise<AsOfBackfillStatus> {
    const view = await pauseCreditAsOfBackfillJob(accountId);
    return viewToStatus(accountId, view);
}

export async function resumeAsOfBackfill(
    accountId: number
): Promise<AsOfBackfillStatus> {
    try {
        const view = await retryCreditAsOfBackfillJob(accountId);
        return viewToStatus(accountId, view);
    } catch {
        return getAsOfBackfillStatus(accountId);
    }
}
