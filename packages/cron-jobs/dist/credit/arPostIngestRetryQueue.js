"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AR_POST_INGEST_RETRY_MAX_ATTEMPTS = exports.AR_POST_INGEST_RETRY_STALE_PROCESSING_MS = void 0;
exports.enqueueArPostIngestSteps = enqueueArPostIngestSteps;
exports.enqueueArPostIngestRetries = enqueueArPostIngestRetries;
exports.drainArPostIngestRetryQueue = drainArPostIngestRetryQueue;
/**
 * Durable retry queue for AR post-ingest step failures.
 *
 * `runArPostIngestForCustomers` is best-effort: it collects step failures and
 * returns so ingest still succeeds. Without a record, a swallowed failure left
 * customers with stale capacity gaps until someone noticed. Failures are
 * enqueued here and retried by the overnight drain.
 */
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
/** Processing rows older than this are assumed abandoned and reclaimed. */
exports.AR_POST_INGEST_RETRY_STALE_PROCESSING_MS = 60 * 60 * 1000;
/** Beyond this the row is parked as `failed` so it stops consuming drain slots. */
exports.AR_POST_INGEST_RETRY_MAX_ATTEMPTS = 5;
/** Steps the drain can safely re-run without the original import payload. */
const RETRYABLE_STEPS = [
    "replay",
    "process_overdue",
    "live_refresh",
];
/**
 * Records per-customer failures for retry. Account-level failures (maturity,
 * as-of enqueue) are skipped: they carry no customer and the as-of path needs
 * the original entity ids, which are gone by the time the drain runs.
 */
async function upsertArPostIngestRetrySteps(db, accountId, customerId, steps, now) {
    const stepList = Array.from(new Set(steps)).sort();
    await db.$executeRaw `
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
/**
 * Intentionally queue post-ingest steps (e.g. after billing connector backfill)
 * so replay/overdue/live-refresh run on the worker instead of blocking sync.
 */
async function enqueueArPostIngestSteps(accountId, customerIds, steps, options) {
    const db = options?.dbClient ?? credit_insurance_domain_1.creditInsurancePrisma;
    const now = options?.now ?? new Date();
    const stepList = steps.filter((step) => RETRYABLE_STEPS.includes(step));
    if (stepList.length === 0) {
        return { customersEnqueued: 0 };
    }
    const uniqueCustomerIds = Array.from(new Set(customerIds.filter(Number.isFinite)));
    for (const customerId of uniqueCustomerIds) {
        await upsertArPostIngestRetrySteps(db, accountId, customerId, stepList, now);
    }
    return { customersEnqueued: uniqueCustomerIds.length };
}
async function enqueueArPostIngestRetries(accountId, errors, options) {
    const db = options?.dbClient ?? credit_insurance_domain_1.creditInsurancePrisma;
    const now = options?.now ?? new Date();
    const stepsByCustomer = new Map();
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
        await upsertArPostIngestRetrySteps(db, accountId, customerId, Array.from(steps), now);
    }
    return { customersEnqueued: stepsByCustomer.size };
}
/**
 * Retries queued customers. Mirrors the as-of rewrite drain: reclaim stale
 * `processing` rows, claim optimistically, reset to `pending` on failure.
 */
async function drainArPostIngestRetryQueue(options) {
    const db = options?.dbClient ?? credit_insurance_domain_1.creditInsurancePrisma;
    const maxItems = options?.maxItems ?? 50;
    const now = options?.now ?? new Date();
    const staleBefore = new Date(now.getTime() - exports.AR_POST_INGEST_RETRY_STALE_PROCESSING_MS);
    await db.$executeRaw `
        UPDATE "ArPostIngestRetryQueue"
        SET status = 'pending', updated_at = ${now}
        WHERE status = 'processing'
          AND updated_at < ${staleBefore}
    `;
    const run = options?.runPostIngest ??
        (async (args) => {
            const { runArPostIngestForCustomers } = await Promise.resolve().then(() => __importStar(require("./arPostIngestOrchestrator")));
            return runArPostIngestForCustomers({
                accountId: args.accountId,
                customerIds: args.customerIds,
                runReplay: args.steps.includes("replay"),
                runProcessOverdue: args.steps.includes("process_overdue"),
                runLiveRefresh: args.steps.includes("live_refresh"),
            });
        });
    const pending = await db.$queryRaw `
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
        const claimed = await db.$executeRaw `
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
                throw new Error(result.errors
                    .map((failure) => `${failure.step}: ${failure.message}`)
                    .join("; "));
            }
            await db.$executeRaw `
                UPDATE "ArPostIngestRetryQueue"
                SET status = 'done', updated_at = ${now}
                WHERE id = ${item.id}
            `;
            itemsProcessed += 1;
        }
        catch (error) {
            failures += 1;
            const message = error instanceof Error ? error.message : String(error);
            const exhausted = item.attempts + 1 >= exports.AR_POST_INGEST_RETRY_MAX_ATTEMPTS;
            if (exhausted) {
                givenUp += 1;
            }
            await db.$executeRaw `
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
