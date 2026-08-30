/**
 * Durable retry queue for AR post-ingest step failures.
 *
 * `runArPostIngestForCustomers` is best-effort: it collects step failures and
 * returns so ingest still succeeds. Without a record, a swallowed failure left
 * customers with stale capacity gaps until someone noticed. Failures are
 * enqueued here and retried by the overnight drain.
 */
import { creditInsurancePrisma as prisma } from "@archaser/credit-insurance-domain";

import type { ArPostIngestError, ArPostIngestStep } from "./arPostIngestOrchestrator";

/** Processing rows older than this are assumed abandoned and reclaimed. */
export const AR_POST_INGEST_RETRY_STALE_PROCESSING_MS = 60 * 60 * 1000;

/** Beyond this the row is parked as `failed` so it stops consuming drain slots. */
export const AR_POST_INGEST_RETRY_MAX_ATTEMPTS = 5;

type DbClient = {
    $executeRaw: (
        query: TemplateStringsArray,
        ...values: unknown[]
    ) => Promise<number>;
    $queryRaw: <T>(
        query: TemplateStringsArray,
        ...values: unknown[]
    ) => Promise<T>;
};

/** Steps the drain can safely re-run without the original import payload. */
const RETRYABLE_STEPS: ArPostIngestStep[] = [
    "replay",
    "process_overdue",
    "live_refresh",
];

export type EnqueueArPostIngestRetryResult = {
    customersEnqueued: number;
};

/**
 * Records per-customer failures for retry. Account-level failures (maturity,
 * as-of enqueue) are skipped: they carry no customer and the as-of path needs
 * the original entity ids, which are gone by the time the drain runs.
 */
export async function enqueueArPostIngestRetries(
    accountId: number,
    errors: ArPostIngestError[],
    options?: { dbClient?: DbClient; now?: Date }
): Promise<EnqueueArPostIngestRetryResult> {
    const db = options?.dbClient ?? (prisma as unknown as DbClient);
    const now = options?.now ?? new Date();

    const stepsByCustomer = new Map<number, Set<string>>();
    for (const failure of errors) {
        if (failure.customerId == null) {
            continue;
        }
        if (!RETRYABLE_STEPS.includes(failure.step)) {
            continue;
        }
        const existing = stepsByCustomer.get(failure.customerId) ?? new Set();
        existing.add(failure.step);
        stepsByCustomer.set(failure.customerId, existing);
    }

    for (const [customerId, steps] of stepsByCustomer) {
        const stepList = Array.from(steps).sort();
        // Re-failing an already-queued customer widens the step set and resets
        // it to pending rather than creating a second row.
        await db.$executeRaw`
            INSERT INTO "ArPostIngestRetryQueue"
                (account_id, customer_id, steps, status, created_at, updated_at)
            VALUES (${accountId}, ${customerId}, ${stepList}, 'pending', ${now}, ${now})
            ON CONFLICT (account_id, customer_id) DO UPDATE
            SET steps = ARRAY(
                    SELECT DISTINCT unnest(
                        "ArPostIngestRetryQueue".steps || EXCLUDED.steps
                    )
                ),
                status = 'pending',
                updated_at = ${now}
        `;
    }

    return { customersEnqueued: stepsByCustomer.size };
}

export type DrainArPostIngestRetryResult = {
    itemsProcessed: number;
    failures: number;
    givenUp: number;
};

type PendingRow = {
    id: bigint;
    account_id: number;
    customer_id: number;
    steps: string[];
    attempts: number;
};

/**
 * Retries queued customers. Mirrors the as-of rewrite drain: reclaim stale
 * `processing` rows, claim optimistically, reset to `pending` on failure.
 */
export async function drainArPostIngestRetryQueue(options?: {
    maxItems?: number;
    dbClient?: DbClient;
    now?: Date;
    runPostIngest?: (args: {
        accountId: number;
        customerIds: number[];
        steps: string[];
    }) => Promise<{ errors: ArPostIngestError[] }>;
}): Promise<DrainArPostIngestRetryResult> {
    const db = options?.dbClient ?? (prisma as unknown as DbClient);
    const maxItems = options?.maxItems ?? 50;
    const now = options?.now ?? new Date();
    const staleBefore = new Date(
        now.getTime() - AR_POST_INGEST_RETRY_STALE_PROCESSING_MS
    );

    await db.$executeRaw`
        UPDATE "ArPostIngestRetryQueue"
        SET status = 'pending', updated_at = ${now}
        WHERE status = 'processing'
          AND updated_at < ${staleBefore}
    `;

    const run =
        options?.runPostIngest ??
        (async (args) => {
            const { runArPostIngestForCustomers } = await import(
                "./arPostIngestOrchestrator"
            );
            return runArPostIngestForCustomers({
                accountId: args.accountId,
                customerIds: args.customerIds,
                runReplay: args.steps.includes("replay"),
                runProcessOverdue: args.steps.includes("process_overdue"),
                runLiveRefresh: args.steps.includes("live_refresh"),
            });
        });

    const pending = await db.$queryRaw<PendingRow[]>`
        SELECT id, account_id, customer_id, steps, attempts
        FROM "ArPostIngestRetryQueue"
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT ${maxItems}
    `;

    let itemsProcessed = 0;
    let failures = 0;
    let givenUp = 0;

    for (const item of pending) {
        const claimed = await db.$executeRaw`
            UPDATE "ArPostIngestRetryQueue"
            SET status = 'processing', updated_at = ${now}
            WHERE id = ${item.id} AND status = 'pending'
        `;
        if (claimed === 0) {
            continue;
        }

        try {
            const result = await run({
                accountId: item.account_id,
                customerIds: [item.customer_id],
                steps: item.steps ?? [],
            });

            if (result.errors.length > 0) {
                throw new Error(
                    result.errors
                        .map((failure) => `${failure.step}: ${failure.message}`)
                        .join("; ")
                );
            }

            await db.$executeRaw`
                UPDATE "ArPostIngestRetryQueue"
                SET status = 'done', updated_at = ${now}
                WHERE id = ${item.id}
            `;
            itemsProcessed += 1;
        } catch (error) {
            failures += 1;
            const message =
                error instanceof Error ? error.message : String(error);
            const exhausted =
                item.attempts + 1 >= AR_POST_INGEST_RETRY_MAX_ATTEMPTS;
            if (exhausted) {
                givenUp += 1;
            }
            await db.$executeRaw`
                UPDATE "ArPostIngestRetryQueue"
                SET status = ${exhausted ? "failed" : "pending"},
                    attempts = attempts + 1,
                    last_error = ${message.slice(0, 1000)},
                    updated_at = ${now}
                WHERE id = ${item.id}
            `;
        }
    }

    return { itemsProcessed, failures, givenUp };
}
