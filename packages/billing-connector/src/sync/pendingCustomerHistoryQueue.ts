/**
 * Durable pending-history queue for new customers discovered on INCREMENTAL
 * Customer import. Drain orchestration lives in a later slice; this module owns
 * enqueue, status summaries, success-clear, and row shape (including scoped
 * progress fields reused from customer-scoped history).
 *
 * Mongo persistence is lazy-loaded so importing this module does not open a
 * mongoose connection (Jest open-handle hygiene).
 */

import type { CustomerScopedEntityCheckpoint } from "./customerScopedHistoryProgress";
import {
    buildBaseLogFields,
    formatBillingConnectorSyncLogLine,
} from "../observability/structuredLog";

export type PendingCustomerHistoryStatus =
    | "pending"
    | "in_progress"
    | "needs_attention";

export type PendingCustomerHistoryRow = {
    connector_id: number;
    account_id: number;
    customer_id: number;
    customer_number: string;
    status: PendingCustomerHistoryStatus;
    attempt_count: number;
    last_error: string | null;
    /** Isolated entity checkpoints for mid-customer resume (slice 01 shape). */
    entities: Record<string, CustomerScopedEntityCheckpoint>;
    enqueued_at: string;
    updated_at: string;
    last_attempt_at: string | null;
};

export type PendingCustomerHistoryStatusSummary = {
    pending_count: number;
    pending_customer_ids: number[];
    needs_attention_count: number;
    needs_attention_customer_ids: number[];
};

export type EnqueuePendingCustomerHistoryInput = {
    connectorId: number;
    accountId: number;
    customerId: number;
    customerNumber: string;
};

export type EnqueuePendingCustomerHistoryResult = {
    enqueued: boolean;
    /** True when a row already existed in pending / in_progress / needs_attention. */
    alreadyPresent: boolean;
    row: PendingCustomerHistoryRow | null;
};

export interface PendingCustomerHistoryQueueStore {
    get(
        connectorId: number,
        customerId: number
    ): Promise<PendingCustomerHistoryRow | null>;
    listByConnector(
        connectorId: number,
        statuses?: readonly PendingCustomerHistoryStatus[]
    ): Promise<PendingCustomerHistoryRow[]>;
    save(row: PendingCustomerHistoryRow): Promise<void>;
    delete(connectorId: number, customerId: number): Promise<void>;
}

const memoryByKey = new Map<string, PendingCustomerHistoryRow>();

function memoryKey(connectorId: number, customerId: number): string {
    return `${connectorId}:${customerId}`;
}

function cloneRow(row: PendingCustomerHistoryRow): PendingCustomerHistoryRow {
    return {
        ...row,
        entities: { ...row.entities },
    };
}

export function createMemoryPendingCustomerHistoryQueueStore(): PendingCustomerHistoryQueueStore {
    return {
        async get(connectorId, customerId) {
            const row = memoryByKey.get(memoryKey(connectorId, customerId));
            return row ? cloneRow(row) : null;
        },
        async listByConnector(connectorId, statuses) {
            const statusSet =
                statuses && statuses.length > 0 ? new Set(statuses) : null;
            const rows: PendingCustomerHistoryRow[] = [];
            for (const row of memoryByKey.values()) {
                if (row.connector_id !== connectorId) {
                    continue;
                }
                if (statusSet && !statusSet.has(row.status)) {
                    continue;
                }
                rows.push(cloneRow(row));
            }
            rows.sort((a, b) => a.customer_id - b.customer_id);
            return rows;
        },
        async save(row) {
            memoryByKey.set(
                memoryKey(row.connector_id, row.customer_id),
                cloneRow(row)
            );
        },
        async delete(connectorId, customerId) {
            memoryByKey.delete(memoryKey(connectorId, customerId));
        },
    };
}

async function loadMongoStore(): Promise<PendingCustomerHistoryQueueStore> {
    const mod = await import("./pendingCustomerHistoryQueueMongo");
    return mod.createMongoPendingCustomerHistoryQueueStore();
}

let activeStore: PendingCustomerHistoryQueueStore | null = null;
let memoryStoreForTests: PendingCustomerHistoryQueueStore | null = null;
const processMemoryFallback = createMemoryPendingCustomerHistoryQueueStore();

function getDefaultStore(): PendingCustomerHistoryQueueStore {
    if (activeStore) {
        return activeStore;
    }
    return createResilientPendingCustomerHistoryQueueStore();
}

function createResilientPendingCustomerHistoryQueueStore(): PendingCustomerHistoryQueueStore {
    let mongoPromise: Promise<PendingCustomerHistoryQueueStore> | null = null;
    const mongo = (): Promise<PendingCustomerHistoryQueueStore> => {
        if (!mongoPromise) {
            mongoPromise = loadMongoStore();
        }
        return mongoPromise;
    };
    return {
        async get(connectorId, customerId) {
            try {
                const fromMongo = await (await mongo()).get(
                    connectorId,
                    customerId
                );
                if (fromMongo) {
                    await processMemoryFallback.save(fromMongo);
                    return fromMongo;
                }
            } catch {
                // fall through to memory
            }
            return processMemoryFallback.get(connectorId, customerId);
        },
        async listByConnector(connectorId, statuses) {
            try {
                const fromMongo = await (await mongo()).listByConnector(
                    connectorId,
                    statuses
                );
                for (const row of fromMongo) {
                    await processMemoryFallback.save(row);
                }
                return fromMongo;
            } catch {
                return processMemoryFallback.listByConnector(
                    connectorId,
                    statuses
                );
            }
        },
        async save(row) {
            await processMemoryFallback.save(row);
            try {
                await (await mongo()).save(row);
            } catch {
                // Memory already has the row for this process.
            }
        },
        async delete(connectorId, customerId) {
            await processMemoryFallback.delete(connectorId, customerId);
            try {
                await (await mongo()).delete(connectorId, customerId);
            } catch {
                // Best-effort
            }
        },
    };
}

export function useMemoryPendingCustomerHistoryQueueStoreForTests(): PendingCustomerHistoryQueueStore {
    memoryStoreForTests = createMemoryPendingCustomerHistoryQueueStore();
    activeStore = memoryStoreForTests;
    return memoryStoreForTests;
}

export function resetPendingCustomerHistoryQueueStoreForTests(): void {
    memoryByKey.clear();
    memoryStoreForTests = null;
    activeStore = null;
}

const ACTIVE_STATUSES: readonly PendingCustomerHistoryStatus[] = [
    "pending",
    "in_progress",
    "needs_attention",
];

const BLOCKING_STATUSES: readonly PendingCustomerHistoryStatus[] = [
    "pending",
    "in_progress",
];

/**
 * Idempotent enqueue for a newly created customer. No-op when a row already
 * exists in pending / in_progress / needs_attention.
 */
export async function enqueuePendingCustomerHistory(
    input: EnqueuePendingCustomerHistoryInput,
    store: PendingCustomerHistoryQueueStore = getDefaultStore()
): Promise<EnqueuePendingCustomerHistoryResult> {
    const existing = await store.get(input.connectorId, input.customerId);
    if (existing && ACTIVE_STATUSES.includes(existing.status)) {
        return { enqueued: false, alreadyPresent: true, row: existing };
    }

    const now = new Date().toISOString();
    const row: PendingCustomerHistoryRow = {
        connector_id: input.connectorId,
        account_id: input.accountId,
        customer_id: input.customerId,
        customer_number: input.customerNumber,
        status: "pending",
        attempt_count: 0,
        last_error: null,
        entities: {},
        enqueued_at: now,
        updated_at: now,
        last_attempt_at: null,
    };
    await store.save(row);
    return { enqueued: true, alreadyPresent: false, row };
}

export type EnqueuePendingCustomerHistoryForCreatesInput = {
    connectorId: number;
    accountId: number;
    /** Skip when BACKFILL (account-wide onboard). */
    syncMode: "BACKFILL" | "INCREMENTAL" | string;
    provider: string;
    createdCustomers: ReadonlyArray<{
        id: number;
        customer_number: string;
    }>;
    executionId?: string | null;
    correlationId?: string | null;
    onLog?: (message: string) => void;
    store?: PendingCustomerHistoryQueueStore;
};

export type EnqueuePendingCustomerHistoryForCreatesResult = {
    attempted: number;
    enqueued: number;
    alreadyPresent: number;
    skippedForSyncMode: boolean;
};

function emitEnqueueStructuredLog(input: {
    accountId: number;
    connectorId: number;
    provider: string;
    syncMode: string;
    customerId: number;
    customerNumber: string;
    executionId?: string | null;
    correlationId?: string | null;
    onLog?: (message: string) => void;
}): void {
    const line = formatBillingConnectorSyncLogLine(
        buildBaseLogFields({
            accountId: input.accountId,
            connectorId: input.connectorId,
            provider: input.provider,
            syncMode: input.syncMode,
            trigger: "pending_customer_history",
            status: "PENDING_HISTORY_ENQUEUED",
            errorType: null,
            executionId: input.executionId,
            correlationId: input.correlationId,
            entityType: "Customer",
            customerId: input.customerId,
            message: `Pending customer history enqueued for customer_id=${input.customerId} customer_number=${input.customerNumber}`,
        })
    );
    if (input.onLog) {
        input.onLog(line);
        return;
    }
    console.log(line);
}

/**
 * Enqueue newly created customers after Customer import on INCREMENTAL sync.
 * No-ops on BACKFILL and when the create list is empty.
 */
export async function enqueuePendingCustomerHistoryForCreates(
    input: EnqueuePendingCustomerHistoryForCreatesInput
): Promise<EnqueuePendingCustomerHistoryForCreatesResult> {
    if (input.syncMode === "BACKFILL") {
        return {
            attempted: 0,
            enqueued: 0,
            alreadyPresent: 0,
            skippedForSyncMode: true,
        };
    }
    if (input.syncMode !== "INCREMENTAL") {
        return {
            attempted: 0,
            enqueued: 0,
            alreadyPresent: 0,
            skippedForSyncMode: true,
        };
    }

    const store = input.store ?? getDefaultStore();
    let enqueued = 0;
    let alreadyPresent = 0;
    const unique = new Map<number, string>();
    for (const customer of input.createdCustomers) {
        if (!Number.isFinite(customer.id) || customer.id <= 0) {
            continue;
        }
        const number = String(customer.customer_number ?? "").trim();
        if (!number) {
            continue;
        }
        unique.set(customer.id, number);
    }

    for (const [customerId, customerNumber] of unique) {
        const result = await enqueuePendingCustomerHistory(
            {
                connectorId: input.connectorId,
                accountId: input.accountId,
                customerId,
                customerNumber,
            },
            store
        );
        if (result.enqueued) {
            enqueued += 1;
            emitEnqueueStructuredLog({
                accountId: input.accountId,
                connectorId: input.connectorId,
                provider: input.provider,
                syncMode: input.syncMode,
                customerId,
                customerNumber,
                executionId: input.executionId,
                correlationId: input.correlationId,
                onLog: input.onLog,
            });
        } else if (result.alreadyPresent) {
            alreadyPresent += 1;
        }
    }

    return {
        attempted: unique.size,
        enqueued,
        alreadyPresent,
        skippedForSyncMode: false,
    };
}

/** Remove a queue row after successful customer-scoped history (drain slice). */
export async function clearPendingCustomerHistoryOnSuccess(params: {
    connectorId: number;
    customerId: number;
    store?: PendingCustomerHistoryQueueStore;
}): Promise<boolean> {
    const store = params.store ?? getDefaultStore();
    const existing = await store.get(params.connectorId, params.customerId);
    if (!existing) {
        return false;
    }
    await store.delete(params.connectorId, params.customerId);
    return true;
}

/** Max hard failures before a row stops blocking incremental (PRD D14/D15). */
export const PENDING_CUSTOMER_HISTORY_MAX_ATTEMPTS = 5;

/**
 * Mark a blocking row in_progress before a customer-scoped history attempt.
 * No-op when missing or already needs_attention.
 */
export async function markPendingCustomerHistoryInProgress(params: {
    connectorId: number;
    customerId: number;
    store?: PendingCustomerHistoryQueueStore;
}): Promise<PendingCustomerHistoryRow | null> {
    const store = params.store ?? getDefaultStore();
    const existing = await store.get(params.connectorId, params.customerId);
    if (!existing || existing.status === "needs_attention") {
        return existing;
    }
    const now = new Date().toISOString();
    existing.status = "in_progress";
    existing.last_attempt_at = now;
    existing.updated_at = now;
    await store.save(existing);
    return existing;
}

export type RecordPendingCustomerHistoryFailureResult = {
    row: PendingCustomerHistoryRow | null;
    needsAttention: boolean;
};

/**
 * Increment attempt_count after a hard failure. At
 * {@link PENDING_CUSTOMER_HISTORY_MAX_ATTEMPTS}, set needs_attention so the
 * row no longer blocks incremental.
 */
export async function recordPendingCustomerHistoryFailure(params: {
    connectorId: number;
    customerId: number;
    error: string;
    maxAttempts?: number;
    store?: PendingCustomerHistoryQueueStore;
}): Promise<RecordPendingCustomerHistoryFailureResult> {
    const store = params.store ?? getDefaultStore();
    const maxAttempts =
        params.maxAttempts ?? PENDING_CUSTOMER_HISTORY_MAX_ATTEMPTS;
    const existing = await store.get(params.connectorId, params.customerId);
    if (!existing) {
        return { row: null, needsAttention: false };
    }
    const now = new Date().toISOString();
    const attemptCount = existing.attempt_count + 1;
    const needsAttention = attemptCount >= maxAttempts;
    existing.attempt_count = attemptCount;
    existing.last_error = params.error.slice(0, 2000);
    existing.last_attempt_at = now;
    existing.updated_at = now;
    existing.status = needsAttention ? "needs_attention" : "pending";
    await store.save(existing);
    return { row: existing, needsAttention };
}

/**
 * Return a row to pending after operator cancel / mid-run stop so drain can
 * resume later without counting a hard failure.
 */
export async function revertPendingCustomerHistoryToPending(params: {
    connectorId: number;
    customerId: number;
    store?: PendingCustomerHistoryQueueStore;
}): Promise<PendingCustomerHistoryRow | null> {
    const store = params.store ?? getDefaultStore();
    const existing = await store.get(params.connectorId, params.customerId);
    if (!existing || existing.status === "needs_attention") {
        return existing;
    }
    const now = new Date().toISOString();
    existing.status = "pending";
    existing.updated_at = now;
    await store.save(existing);
    return existing;
}

export async function listPendingCustomerHistoryRows(
    connectorId: number,
    statuses?: readonly PendingCustomerHistoryStatus[],
    store: PendingCustomerHistoryQueueStore = getDefaultStore()
): Promise<PendingCustomerHistoryRow[]> {
    try {
        return await store.listByConnector(connectorId, statuses);
    } catch {
        return [];
    }
}

/** Rows that must drain before the next incremental (excludes needs_attention). */
export async function listBlockingPendingCustomerHistory(
    connectorId: number,
    store: PendingCustomerHistoryQueueStore = getDefaultStore()
): Promise<PendingCustomerHistoryRow[]> {
    return listPendingCustomerHistoryRows(
        connectorId,
        BLOCKING_STATUSES,
        store
    );
}

export async function getPendingCustomerHistoryStatusSummary(
    connectorId: number,
    store: PendingCustomerHistoryQueueStore = getDefaultStore()
): Promise<PendingCustomerHistoryStatusSummary> {
    const rows = await listPendingCustomerHistoryRows(
        connectorId,
        ACTIVE_STATUSES,
        store
    );
    const pendingIds: number[] = [];
    const needsAttentionIds: number[] = [];
    for (const row of rows) {
        if (row.status === "pending" || row.status === "in_progress") {
            pendingIds.push(row.customer_id);
        } else if (row.status === "needs_attention") {
            needsAttentionIds.push(row.customer_id);
        }
    }
    pendingIds.sort((a, b) => a - b);
    needsAttentionIds.sort((a, b) => a - b);
    return {
        pending_count: pendingIds.length,
        pending_customer_ids: pendingIds,
        needs_attention_count: needsAttentionIds.length,
        needs_attention_customer_ids: needsAttentionIds,
    };
}

/**
 * Persist scoped entity checkpoints onto the queue row (drain / resume).
 * No-op when the row is missing.
 */
export async function upsertPendingCustomerHistoryEntityCheckpoint(params: {
    connectorId: number;
    customerId: number;
    entityType: string;
    checkpoint: CustomerScopedEntityCheckpoint;
    store?: PendingCustomerHistoryQueueStore;
}): Promise<PendingCustomerHistoryRow | null> {
    const store = params.store ?? getDefaultStore();
    const existing = await store.get(params.connectorId, params.customerId);
    if (!existing) {
        return null;
    }
    const now = new Date().toISOString();
    existing.entities[params.entityType] = params.checkpoint;
    existing.updated_at = now;
    await store.save(existing);
    return existing;
}
