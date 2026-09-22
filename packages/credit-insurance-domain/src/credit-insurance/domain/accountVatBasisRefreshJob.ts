import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import { ACCOUNT_BACKGROUND_JOB_KIND } from "./accountBackgroundJob";
import { toUtcDayStart } from "./asOfOpenAr";
import {
    CreditAsOfBackfillConflictError,
    startCreditAsOfBackfillJob,
} from "./creditAsOfBackfillJob";
import { resolveReportingBreachStartDate } from "./resolveReportingBreachStartDate";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";

type PrismaClientLike = PrismaClient | DbClient;

const VAT_BASIS_JOB_KIND = ACCOUNT_BACKGROUND_JOB_KIND.VAT_BASIS_REFRESH;

export type AccountVatBasisRefreshStatus =
    | "idle"
    | "running"
    | "failed"
    | "complete";

export type AccountVatBasisRefreshJobView = {
    status: AccountVatBasisRefreshStatus;
    customersTotal: number;
    customersDone: number;
    lastError: string | null;
    requestedBy: string | null;
    startedAt: string | null;
    updatedAt: string | null;
    avgSecondsPerCustomer: number | null;
    estimatedSecondsRemaining: number | null;
};

type JobRow = {
    account_id: number;
    status: string;
    customers_total: number;
    customers_done: number;
    run_token: string | null;
    last_error: string | null;
    requested_by: string | null;
    started_at: Date | null;
    updated_at: Date;
};

export type VatBasisRefreshBalancesFn = (
    customerIds: number[],
    db: PrismaClientLike,
    options?: {
        onProgress?: (progress: { processed: number; total: number }) => void;
        concurrency?: number;
        progressEvery?: number;
    }
) => Promise<unknown>;

type VatBasisRefreshDispatch = (
    accountId: number
) => Promise<{ queued: boolean; reason?: string }>;

let balancesFinal: VatBasisRefreshBalancesFn | null = null;
let vatBasisRefreshDispatch: VatBasisRefreshDispatch | null = null;
const runnersInFlight = new Set<number>();

const CUSTOMER_BATCH_SIZE = 50;

export function registerVatBasisRefreshBalances(
    fn: VatBasisRefreshBalancesFn | null
): void {
    balancesFinal = fn;
}

/** API / worker host registers BullMQ enqueue; tests omit and use inline run. */
export function registerAccountVatBasisRefreshDispatch(
    dispatch: VatBasisRefreshDispatch | null
): void {
    vatBasisRefreshDispatch = dispatch;
}

export function accountVatBasisRefreshBullJobId(accountId: number): string {
    return `account-vat-basis-refresh-${accountId}`;
}

function normalizeStatus(
    raw: string | null | undefined
): AccountVatBasisRefreshStatus {
    switch (raw) {
        case "running":
        case "failed":
        case "complete":
        case "idle":
            return raw;
        default:
            return "idle";
    }
}

function computeRunEstimates(row: JobRow): {
    avgSecondsPerCustomer: number | null;
    estimatedSecondsRemaining: number | null;
} {
    const done = Number(row.customers_done ?? 0);
    const total = Number(row.customers_total ?? 0);
    if (
        row.status !== "running" ||
        !row.started_at ||
        done <= 0 ||
        total <= done
    ) {
        return {
            avgSecondsPerCustomer: null,
            estimatedSecondsRemaining: null,
        };
    }
    const elapsedSec = Math.max(
        0,
        (Date.now() - row.started_at.getTime()) / 1000
    );
    const avg = elapsedSec / done;
    return {
        avgSecondsPerCustomer: Math.round(avg * 10) / 10,
        estimatedSecondsRemaining: Math.round(avg * (total - done)),
    };
}

function jobView(row: JobRow | null): AccountVatBasisRefreshJobView {
    if (!row) {
        return {
            status: "idle",
            customersTotal: 0,
            customersDone: 0,
            lastError: null,
            requestedBy: null,
            startedAt: null,
            updatedAt: null,
            avgSecondsPerCustomer: null,
            estimatedSecondsRemaining: null,
        };
    }
    const estimates = computeRunEstimates(row);
    return {
        status: normalizeStatus(row.status),
        customersTotal: Number(row.customers_total ?? 0),
        customersDone: Number(row.customers_done ?? 0),
        lastError: row.last_error,
        requestedBy: row.requested_by,
        startedAt: row.started_at?.toISOString() ?? null,
        updatedAt: row.updated_at?.toISOString() ?? null,
        avgSecondsPerCustomer: estimates.avgSecondsPerCustomer,
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
            units_total AS customers_total,
            units_done AS customers_done,
            run_token,
            last_error,
            requested_by,
            started_at,
            updated_at
        FROM "AccountBackgroundJob"
        WHERE account_id = ${accountId}
          AND job_kind = ${VAT_BASIS_JOB_KIND}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function listRunningAccountVatBasisRefreshAccountIds(
    options?: { dbClient?: PrismaClientLike }
): Promise<number[]> {
    const db = options?.dbClient ?? defaultPrisma;
    const rows = await db.$queryRaw<{ account_id: number }[]>`
        SELECT account_id
        FROM "AccountBackgroundJob"
        WHERE job_kind = ${VAT_BASIS_JOB_KIND}
          AND status = 'running'
    `;
    return rows.map((r) => Number(r.account_id));
}

export async function getAccountVatBasisRefreshJobStatus(
    accountId: number,
    options?: { dbClient?: PrismaClientLike }
): Promise<AccountVatBasisRefreshJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    return jobView(await loadJob(accountId, db));
}

async function dispatchRunner(accountId: number): Promise<void> {
    if (vatBasisRefreshDispatch) {
        const result = await vatBasisRefreshDispatch(accountId);
        if (result.queued) {
            return;
        }
    }
    void runAccountVatBasisRefreshJob(accountId).catch((error) => {
        console.error("[AccountVatBasisRefresh] inline runner failed", {
            accountId,
            errorMessage:
                error instanceof Error ? error.message : String(error),
        });
    });
}

async function listAccountCustomerIds(
    accountId: number,
    db: PrismaClientLike
): Promise<number[]> {
    const rows = await db.customer.findMany({
        where: { account_id: accountId },
        select: { id: true },
        orderBy: { id: "asc" },
    });
    return rows.map((r) => r.id);
}

/**
 * Persist setting change already happened; enqueue account-wide denormalized refresh.
 * Mid-job flip supersedes by resetting the row with a new run_token.
 */
export async function enqueueAccountVatBasisRefresh(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        requestedBy?: string | null;
    }
): Promise<AccountVatBasisRefreshJobView> {
    return startAccountVatBasisRefreshJob(accountId, {
        dbClient: options?.dbClient,
        requestedBy: options?.requestedBy ?? null,
    });
}

export async function startAccountVatBasisRefreshJob(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        requestedBy?: string | null;
    }
): Promise<AccountVatBasisRefreshJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    const now = new Date();
    const runToken = randomUUID();
    const customerIds = await listAccountCustomerIds(accountId, db);
    const total = customerIds.length;

    await db.$executeRaw`
        INSERT INTO "AccountBackgroundJob" (
            account_id,
            job_kind,
            status,
            units_total,
            units_done,
            run_token,
            last_error,
            requested_by,
            started_at,
            created_at,
            updated_at
        ) VALUES (
            ${accountId},
            ${VAT_BASIS_JOB_KIND},
            'running',
            ${total},
            0,
            ${runToken},
            NULL,
            ${options?.requestedBy ?? null},
            ${now},
            ${now},
            ${now}
        )
        ON CONFLICT (account_id, job_kind) DO UPDATE SET
            status = 'running',
            units_total = ${total},
            units_done = 0,
            run_token = ${runToken},
            last_error = NULL,
            requested_by = ${options?.requestedBy ?? null},
            started_at = ${now},
            updated_at = ${now}
    `;

    await dispatchRunner(accountId);
    return getAccountVatBasisRefreshJobStatus(accountId, { dbClient: db });
}

export async function retryAccountVatBasisRefreshJob(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        requestedBy?: string | null;
    }
): Promise<AccountVatBasisRefreshJobView> {
    const db = options?.dbClient ?? defaultPrisma;
    const existing = await loadJob(accountId, db);
    if (!existing || existing.status !== "failed") {
        throw new Error(
            "VAT basis refresh can only be retried from a failed state"
        );
    }
    return startAccountVatBasisRefreshJob(accountId, options);
}

/**
 * After live rollups/gaps finish, rewrite CPT + credit-dashboard daily
 * snapshots so trailing customer cards and portfolio health match the new
 * VAT basis. Best-effort: conflict / missing reporting start is logged only.
 */
async function enqueueCptRewriteAfterVatBasisRefresh(
    accountId: number,
    db: PrismaClientLike,
    requestedBy: string | null
): Promise<void> {
    try {
        const reportingStart = await resolveReportingBreachStartDate(
            accountId,
            db
        );
        if (reportingStart == null) {
            console.warn(
                "[AccountVatBasisRefresh] skipping CPT rewrite (no reporting_breach_start_date)",
                { accountId }
            );
            return;
        }
        const today = toUtcDayStart(new Date());
        const from = toUtcDayStart(reportingStart);
        if (from.getTime() > today.getTime()) {
            return;
        }
        await startCreditAsOfBackfillJob(accountId, from, today, {
            dbClient: db,
            requestedBy:
                requestedBy ?? "account-vat-basis-refresh",
        });
    } catch (error) {
        if (error instanceof CreditAsOfBackfillConflictError) {
            console.warn(
                "[AccountVatBasisRefresh] CPT rewrite deferred (Generate already running)",
                { accountId }
            );
            return;
        }
        console.error("[AccountVatBasisRefresh] CPT rewrite enqueue failed", {
            accountId,
            errorMessage:
                error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * Refresh denormalized customer due/overdue rollups + insurance gap fields.
 * Checks run_token between batches so a mid-job flip supersedes cleanly.
 */
export async function runAccountVatBasisRefreshJob(
    accountId: number,
    options?: {
        dbClient?: PrismaClientLike;
        recalculateBalances?: VatBasisRefreshBalancesFn;
        syncInsurance?: (
            customerId: number,
            opts?: { dbClient?: DbClient }
        ) => Promise<unknown>;
    }
): Promise<AccountVatBasisRefreshJobView> {
    if (runnersInFlight.has(accountId)) {
        return getAccountVatBasisRefreshJobStatus(accountId, {
            dbClient: options?.dbClient,
        });
    }
    runnersInFlight.add(accountId);
    const db = options?.dbClient ?? defaultPrisma;
    const recalculate =
        options?.recalculateBalances ?? balancesFinal;
    const syncInsurance =
        options?.syncInsurance ?? syncCustomerInsuranceFields;
    let runTokenForSupersedeCheck: string | null = null;

    try {
        let job = await loadJob(accountId, db);
        if (!job || job.status !== "running" || !job.run_token) {
            return jobView(job);
        }
        const runToken = job.run_token;
        runTokenForSupersedeCheck = runToken;

        if (!recalculate) {
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET status = 'failed',
                    last_error = ${"VAT basis refresh balances host is not registered"},
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${VAT_BASIS_JOB_KIND}
                  AND run_token = ${runToken}
            `;
            return getAccountVatBasisRefreshJobStatus(accountId, {
                dbClient: db,
            });
        }

        const customerIds = await listAccountCustomerIds(accountId, db);
        const total = customerIds.length;

        await db.$executeRaw`
            UPDATE "AccountBackgroundJob"
            SET units_total = ${total},
                updated_at = ${new Date()}
            WHERE account_id = ${accountId}
              AND job_kind = ${VAT_BASIS_JOB_KIND}
              AND run_token = ${runToken}
              AND status = 'running'
        `;

        if (total === 0) {
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET status = 'complete',
                    units_done = 0,
                    units_total = 0,
                    last_error = NULL,
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${VAT_BASIS_JOB_KIND}
                  AND run_token = ${runToken}
                  AND status = 'running'
            `;
            await enqueueCptRewriteAfterVatBasisRefresh(
                accountId,
                db,
                job.requested_by
            );
            return getAccountVatBasisRefreshJobStatus(accountId, {
                dbClient: db,
            });
        }

        let done = 0;
        for (let i = 0; i < customerIds.length; i += CUSTOMER_BATCH_SIZE) {
            const latest = await loadJob(accountId, db);
            if (
                !latest ||
                latest.status !== "running" ||
                latest.run_token !== runToken
            ) {
                // Superseded or paused externally.
                return jobView(latest);
            }

            const batch = customerIds.slice(i, i + CUSTOMER_BATCH_SIZE);
            await recalculate(batch, db, {
                progressEvery: batch.length,
            });

            for (const customerId of batch) {
                try {
                    await syncInsurance(customerId, { dbClient: db });
                } catch (error) {
                    console.error(
                        "[AccountVatBasisRefresh] insurance sync failed",
                        {
                            accountId,
                            customerId,
                            errorMessage:
                                error instanceof Error
                                    ? error.message
                                    : String(error),
                        }
                    );
                }
            }

            done = Math.min(total, i + batch.length);
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET units_done = ${done},
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${VAT_BASIS_JOB_KIND}
                  AND run_token = ${runToken}
                  AND status = 'running'
            `;
        }

        const stillMine = await loadJob(accountId, db);
        if (
            !stillMine ||
            stillMine.run_token !== runToken ||
            stillMine.status !== "running"
        ) {
            return jobView(stillMine);
        }

        await db.$executeRaw`
            UPDATE "AccountBackgroundJob"
            SET status = 'complete',
                units_done = ${total},
                last_error = NULL,
                updated_at = ${new Date()}
            WHERE account_id = ${accountId}
              AND job_kind = ${VAT_BASIS_JOB_KIND}
              AND run_token = ${runToken}
              AND status = 'running'
        `;
        await enqueueCptRewriteAfterVatBasisRefresh(
            accountId,
            db,
            stillMine.requested_by
        );
        return getAccountVatBasisRefreshJobStatus(accountId, { dbClient: db });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : String(error);
        if (runTokenForSupersedeCheck) {
            await db.$executeRaw`
                UPDATE "AccountBackgroundJob"
                SET status = 'failed',
                    last_error = ${message},
                    updated_at = ${new Date()}
                WHERE account_id = ${accountId}
                  AND job_kind = ${VAT_BASIS_JOB_KIND}
                  AND run_token = ${runTokenForSupersedeCheck}
                  AND status = 'running'
            `;
        }
        return getAccountVatBasisRefreshJobStatus(accountId, { dbClient: db });
    } finally {
        runnersInFlight.delete(accountId);
        // Mid-job flip supersedes via a new run_token while this runner was
        // in-flight; kick the latest running job now that the lock is free.
        try {
            const latest = await loadJob(accountId, db);
            if (
                latest?.status === "running" &&
                latest.run_token &&
                latest.run_token !== runTokenForSupersedeCheck
            ) {
                void dispatchRunner(accountId);
            }
        } catch {
            // ignore follow-up kick failures
        }
    }
}
