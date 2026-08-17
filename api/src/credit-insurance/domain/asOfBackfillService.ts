import { prisma } from "../domain-db";
import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";

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

const runningAccounts = new Set<number>();

function toDayStartUtc(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

function dateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
}

function daysInclusive(from: Date, to: Date): number {
    const ms = toDayStartUtc(to).getTime() - toDayStartUtc(from).getTime();
    return ms < 0 ? 0 : Math.floor(ms / 86_400_000) + 1;
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
               days_total, days_done, last_error, started_at, updated_at
        FROM "CreditAsOfBackfillJob"
        WHERE account_id = ${accountId}
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

export async function startAsOfBackfill(
    accountId: number,
    requestedBy: string | null
): Promise<AsOfBackfillStatus> {
    const existing = await readRow(accountId);
    if (existing?.status === "running") {
        return rowToStatus(existing);
    }

    const toDate = startOfTodayUtc();
    const agg = await prisma.invoice.aggregate({
        where: { customer_id: { not: null }, Customer: { account_id: accountId } },
        _min: { invoice_date: true },
    });
    const earliest = agg._min.invoice_date;

    if (!earliest) {
        await prisma.$executeRaw`
            INSERT INTO "CreditAsOfBackfillJob" (
                account_id, status, from_date, to_date, checkpoint_date,
                days_total, days_done, last_error, requested_by, started_at, updated_at
            ) VALUES (
                ${accountId}, 'complete', NULL, NULL, NULL, 0, 0, NULL,
                ${requestedBy}, NOW(), NOW()
            )
            ON CONFLICT (account_id) DO UPDATE SET
                status = 'complete', from_date = NULL, to_date = NULL,
                checkpoint_date = NULL, days_total = 0, days_done = 0,
                last_error = NULL, requested_by = ${requestedBy},
                started_at = NOW(), updated_at = NOW()
        `;
        return getAsOfBackfillStatus(accountId);
    }

    const fromDate = toDayStartUtc(earliest);
    const daysTotal = daysInclusive(fromDate, toDate);
    await prisma.$executeRaw`
        INSERT INTO "CreditAsOfBackfillJob" (
            account_id, status, from_date, to_date, checkpoint_date,
            days_total, days_done, last_error, requested_by, started_at, updated_at
        ) VALUES (
            ${accountId}, 'running', ${fromDate}, ${toDate}, ${fromDate},
            ${daysTotal}, 0, NULL, ${requestedBy}, NOW(), NOW()
        )
        ON CONFLICT (account_id) DO UPDATE SET
            status = 'running', from_date = ${fromDate}, to_date = ${toDate},
            checkpoint_date = ${fromDate}, days_total = ${daysTotal},
            days_done = 0, last_error = NULL, requested_by = ${requestedBy},
            started_at = NOW(), updated_at = NOW()
    `;

    void launchRunner(accountId);
    return getAsOfBackfillStatus(accountId);
}

export async function pauseAsOfBackfill(
    accountId: number
): Promise<AsOfBackfillStatus> {
    await prisma.$executeRaw`
        UPDATE "CreditAsOfBackfillJob"
        SET status = 'paused', updated_at = NOW()
        WHERE account_id = ${accountId} AND status = 'running'
    `;
    return getAsOfBackfillStatus(accountId);
}

export async function resumeAsOfBackfill(
    accountId: number
): Promise<AsOfBackfillStatus> {
    const updated = await prisma.$executeRaw`
        UPDATE "CreditAsOfBackfillJob"
        SET status = 'running', last_error = NULL, updated_at = NOW()
        WHERE account_id = ${accountId} AND status = 'paused'
    `;
    if (updated > 0) {
        void launchRunner(accountId);
    }
    return getAsOfBackfillStatus(accountId);
}

async function launchRunner(accountId: number): Promise<void> {
    if (runningAccounts.has(accountId)) return;

    runningAccounts.add(accountId);
    try {
        await runBackfillLoop(accountId);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await prisma.$executeRaw`
            UPDATE "CreditAsOfBackfillJob"
            SET status = 'failed', last_error = ${message.slice(0, 1000)},
                updated_at = NOW()
            WHERE account_id = ${accountId}
        `.catch(() => {});
    } finally {
        runningAccounts.delete(accountId);
    }
}

async function runBackfillLoop(accountId: number): Promise<void> {
    const { syncCustomerPolicyTrendSnapshotForAccount } = await import(
        "./customerPolicyTrendService"
    );
    const { takeCreditDashboardDailySnapshotsForAccount } = await import(
        "./creditDashboardSnapshotService"
    );

    for (let guard = 0; guard < 4200; guard += 1) {
        const row = await readRow(accountId);
        if (
            !row ||
            row.status !== "running" ||
            !row.checkpoint_date ||
            !row.to_date
        ) {
            return;
        }

        const day = toDayStartUtc(row.checkpoint_date);
        if (day.getTime() > toDayStartUtc(row.to_date).getTime()) {
            await prisma.$executeRaw`
                UPDATE "CreditAsOfBackfillJob"
                SET status = 'complete', days_done = days_total, updated_at = NOW()
                WHERE account_id = ${accountId}
            `;
            return;
        }

        try {
            await syncCustomerPolicyTrendSnapshotForAccount(accountId, {
                snapshotDate: day,
            });
            await takeCreditDashboardDailySnapshotsForAccount(accountId, {
                snapshotDate: day,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await prisma.$executeRaw`
                UPDATE "CreditAsOfBackfillJob"
                SET status = 'failed', last_error = ${message.slice(0, 1000)},
                    updated_at = NOW()
                WHERE account_id = ${accountId}
            `;
            return;
        }

        const nextDay = new Date(day);
        nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        await prisma.$executeRaw`
            UPDATE "CreditAsOfBackfillJob"
            SET checkpoint_date = ${nextDay}, days_done = days_done + 1,
                updated_at = NOW()
            WHERE account_id = ${accountId}
        `;
    }
}
