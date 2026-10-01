/**
 * Save-time progress for parent_customer_id changes on the shared
 * `credit_pool_parent_history` AccountBackgroundJob row.
 *
 * Status `syncing` = in-request remirror/CTP/CDP/rollups (polled by the modal).
 * Status `running` = async CTP history (existing job runner).
 * `asOfRewriteQueue` must not block on `syncing` (same request rewrites today).
 */
import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import { ACCOUNT_BACKGROUND_JOB_KIND } from "./accountBackgroundJob";
import {
    type CreditAsOfBackfillJobView,
    type CreditAsOfBackfillStatus,
} from "./creditAsOfBackfillJob";

const PARENT_HISTORY_JOB_KIND =
    ACCOUNT_BACKGROUND_JOB_KIND.CREDIT_POOL_PARENT_HISTORY;

export class CreditPoolParentHistoryConflictError extends Error {
    constructor(
        message = "A parent-link credit history refresh is already running for this account"
    ) {
        super(message);
        this.name = "CreditPoolParentHistoryConflictError";
    }
}

export const PARENT_CHANGE_SYNC_STEPS = [
    "remirror",
    "capacity_gap",
    "ctp_today",
    "ctp_overlay",
    "cdp_today",
    "breach_and_open_ar",
    "history",
] as const;

export type ParentChangeSyncStep = (typeof PARENT_CHANGE_SYNC_STEPS)[number];

export type ParentChangeJobPhase = "sync" | "history";

const SYNC_STEP_INDEX = new Map<ParentChangeSyncStep, number>(
    PARENT_CHANGE_SYNC_STEPS.map((step, index) => [step, index])
);

type PrismaClientLike = DbClient;

function encodeSyncRunToken(step: ParentChangeSyncStep, nonce: string): string {
    return `sync:${step}:${nonce}`;
}

export function parseParentChangeRunToken(runToken: string | null | undefined): {
    phase: ParentChangeJobPhase | null;
    step: ParentChangeSyncStep | null;
} {
    if (runToken == null || runToken === "") {
        return { phase: null, step: null };
    }
    if (runToken.startsWith("sync:")) {
        const step = runToken.split(":")[1] as ParentChangeSyncStep | undefined;
        if (step && SYNC_STEP_INDEX.has(step)) {
            return { phase: "sync", step };
        }
        return { phase: "sync", step: "remirror" };
    }
    return { phase: "history", step: "history" };
}

export function enrichParentHistoryJobView(
    view: CreditAsOfBackfillJobView,
    runToken: string | null | undefined,
    rawStatus: string | null | undefined
): CreditAsOfBackfillJobView {
    const parsed = parseParentChangeRunToken(runToken);
    const status: CreditAsOfBackfillStatus =
        rawStatus === "syncing"
            ? "syncing"
            : view.status;
    const stepIndex =
        parsed.step != null ? (SYNC_STEP_INDEX.get(parsed.step) ?? 0) : 0;
    const syncing = status === "syncing" || parsed.phase === "sync";
    return {
        ...view,
        status,
        phase: parsed.phase,
        step: parsed.step,
        syncStepsTotal: PARENT_CHANGE_SYNC_STEPS.length,
        syncStepsDone: syncing
            ? stepIndex
            : status === "complete" || parsed.phase === "history"
              ? PARENT_CHANGE_SYNC_STEPS.length
              : 0,
    };
}

/**
 * Create/update the job row as `syncing` before remirror so the modal can poll.
 */
export async function beginCreditPoolParentChangeSyncProgress(args: {
    accountId: number;
    requestedBy?: string | null;
    dbClient?: PrismaClientLike;
}): Promise<CreditAsOfBackfillJobView> {
    const db = args.dbClient ?? defaultPrisma;
    const existing = await db.$queryRaw<
        Array<{ status: string; run_token: string | null }>
    >`
        SELECT status, run_token
        FROM "AccountBackgroundJob"
        WHERE account_id = ${args.accountId}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
        LIMIT 1
    `;
    const row = existing[0];
    if (
        row &&
        (row.status === "running" ||
            row.status === "paused" ||
            row.status === "syncing")
    ) {
        throw new CreditPoolParentHistoryConflictError();
    }

    const now = new Date();
    const nonce = `${now.getTime()}`;
    const runToken = encodeSyncRunToken("remirror", nonce);

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
            'syncing',
            NULL,
            NULL,
            NULL,
            ${PARENT_CHANGE_SYNC_STEPS.length},
            0,
            ${runToken},
            NULL,
            ${args.requestedBy ?? null},
            ${now},
            ${now},
            ${now}
        )
        ON CONFLICT (account_id, job_kind) DO UPDATE SET
            status = 'syncing',
            from_date = NULL,
            to_date = NULL,
            checkpoint_date = NULL,
            units_total = ${PARENT_CHANGE_SYNC_STEPS.length},
            units_done = 0,
            run_token = EXCLUDED.run_token,
            last_error = NULL,
            requested_by = EXCLUDED.requested_by,
            started_at = EXCLUDED.started_at,
            updated_at = EXCLUDED.updated_at
    `;

    const { getCreditPoolParentHistoryJobStatus } = await import(
        "./creditPoolParentHistoryJob"
    );
    return getCreditPoolParentHistoryJobStatus(args.accountId, {
        dbClient: db,
    });
}

export async function setCreditPoolParentChangeSyncStep(args: {
    accountId: number;
    step: ParentChangeSyncStep;
    dbClient?: PrismaClientLike;
}): Promise<void> {
    const db = args.dbClient ?? defaultPrisma;
    const stepIndex = SYNC_STEP_INDEX.get(args.step) ?? 0;
    const nonce = `${Date.now()}`;
    const runToken = encodeSyncRunToken(args.step, nonce);
    await db.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'syncing',
            run_token = ${runToken},
            units_total = ${PARENT_CHANGE_SYNC_STEPS.length},
            units_done = ${stepIndex},
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE account_id = ${args.accountId}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status IN ('syncing', 'running')
    `;
}

export async function failCreditPoolParentChangeSyncProgress(args: {
    accountId: number;
    step?: ParentChangeSyncStep | null;
    errorMessage: string;
    dbClient?: PrismaClientLike;
}): Promise<void> {
    const db = args.dbClient ?? defaultPrisma;
    let step: ParentChangeSyncStep = args.step ?? "remirror";
    if (args.step == null) {
        const rows = await db.$queryRaw<Array<{ run_token: string | null }>>`
            SELECT run_token
            FROM "AccountBackgroundJob"
            WHERE account_id = ${args.accountId}
              AND job_kind = ${PARENT_HISTORY_JOB_KIND}
            LIMIT 1
        `;
        const parsed = parseParentChangeRunToken(rows[0]?.run_token);
        if (parsed.step) {
            step = parsed.step;
        }
    }
    const runToken = encodeSyncRunToken(step, `${Date.now()}`);
    const stepIndex = SYNC_STEP_INDEX.get(step) ?? 0;
    await db.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'failed',
            run_token = ${runToken},
            units_total = ${PARENT_CHANGE_SYNC_STEPS.length},
            units_done = ${stepIndex},
            last_error = ${args.errorMessage.slice(0, 2000)},
            updated_at = ${new Date()}
        WHERE account_id = ${args.accountId}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status IN ('syncing', 'running')
    `;
}

/** When no async history is needed, mark the Save-time job complete. */
export async function completeCreditPoolParentChangeSyncProgress(args: {
    accountId: number;
    dbClient?: PrismaClientLike;
}): Promise<void> {
    const db = args.dbClient ?? defaultPrisma;
    await db.$executeRaw`
        UPDATE "AccountBackgroundJob"
        SET status = 'complete',
            units_done = GREATEST(units_done, units_total),
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE account_id = ${args.accountId}
          AND job_kind = ${PARENT_HISTORY_JOB_KIND}
          AND status = 'syncing'
    `;
}
