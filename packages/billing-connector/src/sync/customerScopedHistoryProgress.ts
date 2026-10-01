/**
 * Isolated progress for customer-scoped history loads (Start backfill with
 * customer_id, and later automated drain). Must not write account-level
 * ConnectorSyncState cursors / last_max_updated_at — those stay INCREMENTAL-safe.
 *
 * One in-flight customer history per connector (sequential sync mutex).
 *
 * Mongo persistence is lazy-loaded so importing this module does not open a
 * mongoose connection (Jest open-handle hygiene).
 */

export type CustomerScopedEntityCheckpoint = {
    entity_type: string;
    backfill_cursor: string | null;
    backfill_records_pulled: number;
    backfill_total_records: number | null;
    backfill_completed: boolean;
    last_error: string | null;
    last_checkpoint_at: string | null;
};

export type CustomerScopedHistoryProgress = {
    connector_id: number;
    account_id: number;
    customer_id: number;
    customer_number: string;
    entities: Record<string, CustomerScopedEntityCheckpoint>;
    updated_at: string;
};

export type UpsertCustomerScopedEntityCheckpointInput = {
    connectorId: number;
    accountId: number;
    customerId: number;
    customerNumber: string;
    entityType: string;
    backfillCursor: string | null;
    backfillRecordsPulled: number;
    backfillTotalRecords: number | null;
    pageComplete: boolean;
    lastError: string | null;
};

export interface CustomerScopedHistoryProgressStore {
    get(
        connectorId: number
    ): Promise<CustomerScopedHistoryProgress | null>;
    save(progress: CustomerScopedHistoryProgress): Promise<void>;
    clear(connectorId: number): Promise<void>;
}

const memoryByConnector = new Map<number, CustomerScopedHistoryProgress>();

export function createMemoryCustomerScopedHistoryProgressStore(): CustomerScopedHistoryProgressStore {
    return {
        async get(connectorId) {
            return memoryByConnector.get(connectorId) ?? null;
        },
        async save(progress) {
            memoryByConnector.set(progress.connector_id, {
                ...progress,
                entities: { ...progress.entities },
            });
        },
        async clear(connectorId) {
            memoryByConnector.delete(connectorId);
        },
    };
}

async function loadMongoStore(): Promise<CustomerScopedHistoryProgressStore> {
    const mod = await import("./customerScopedHistoryProgressMongo");
    return mod.createMongoCustomerScopedHistoryProgressStore();
}

let activeStore: CustomerScopedHistoryProgressStore | null = null;
let memoryStoreForTests: CustomerScopedHistoryProgressStore | null = null;
const processMemoryFallback = createMemoryCustomerScopedHistoryProgressStore();

function getDefaultStore(): CustomerScopedHistoryProgressStore {
    if (activeStore) {
        return activeStore;
    }
    return createResilientCustomerScopedHistoryProgressStore();
}

/**
 * Prefer Mongo for durable resume across restarts; on connect/write failure
 * keep progress in process memory so a single run still isolates account state.
 */
function createResilientCustomerScopedHistoryProgressStore(): CustomerScopedHistoryProgressStore {
    let mongoPromise: Promise<CustomerScopedHistoryProgressStore> | null = null;
    const mongo = (): Promise<CustomerScopedHistoryProgressStore> => {
        if (!mongoPromise) {
            mongoPromise = loadMongoStore();
        }
        return mongoPromise;
    };
    return {
        async get(connectorId) {
            try {
                const fromMongo = await (await mongo()).get(connectorId);
                if (fromMongo) {
                    await processMemoryFallback.save(fromMongo);
                    return fromMongo;
                }
            } catch {
                // fall through to memory
            }
            return processMemoryFallback.get(connectorId);
        },
        async save(progress) {
            await processMemoryFallback.save(progress);
            try {
                await (await mongo()).save(progress);
            } catch {
                // Memory already has the checkpoint for this process.
            }
        },
        async clear(connectorId) {
            await processMemoryFallback.clear(connectorId);
            try {
                await (await mongo()).clear(connectorId);
            } catch {
                // Best-effort
            }
        },
    };
}

export function useMemoryCustomerScopedHistoryProgressStoreForTests(): CustomerScopedHistoryProgressStore {
    memoryStoreForTests = createMemoryCustomerScopedHistoryProgressStore();
    activeStore = memoryStoreForTests;
    return memoryStoreForTests;
}

export function resetCustomerScopedHistoryProgressStoreForTests(): void {
    memoryByConnector.clear();
    memoryStoreForTests = null;
    activeStore = null;
}

export async function getCustomerScopedHistoryProgress(
    connectorId: number,
    store: CustomerScopedHistoryProgressStore = getDefaultStore()
): Promise<CustomerScopedHistoryProgress | null> {
    try {
        return await store.get(connectorId);
    } catch {
        // Mongo blip — treat as no isolated progress (caller keeps account path).
        return null;
    }
}

/**
 * Resume must stay on the same Archaser customer_id until that history finishes.
 * Returns null when there is no incomplete isolated progress.
 */
export async function getIncompleteCustomerScopedHistoryProgress(
    connectorId: number,
    store: CustomerScopedHistoryProgressStore = getDefaultStore()
): Promise<CustomerScopedHistoryProgress | null> {
    const progress = await getCustomerScopedHistoryProgress(connectorId, store);
    if (!progress) {
        return null;
    }
    const entities = Object.values(progress.entities);
    if (entities.length === 0) {
        return progress;
    }
    const allComplete = entities.every((entity) => entity.backfill_completed);
    return allComplete ? null : progress;
}

export async function clearCustomerScopedHistoryProgress(
    connectorId: number,
    store: CustomerScopedHistoryProgressStore = getDefaultStore()
): Promise<void> {
    try {
        await store.clear(connectorId);
    } catch {
        // Best-effort clear — next Start for this connector overwrites.
    }
}

export async function ensureCustomerScopedHistoryProgressOwner(params: {
    connectorId: number;
    accountId: number;
    customerId: number;
    customerNumber: string;
    store?: CustomerScopedHistoryProgressStore;
}): Promise<CustomerScopedHistoryProgress> {
    const store = params.store ?? getDefaultStore();
    const existing = await getCustomerScopedHistoryProgress(
        params.connectorId,
        store
    );
    if (
        existing &&
        existing.customer_id === params.customerId &&
        existing.customer_number === params.customerNumber
    ) {
        return existing;
    }
    const fresh: CustomerScopedHistoryProgress = {
        connector_id: params.connectorId,
        account_id: params.accountId,
        customer_id: params.customerId,
        customer_number: params.customerNumber,
        entities: {},
        updated_at: new Date().toISOString(),
    };
    await store.save(fresh);
    return fresh;
}

export async function upsertCustomerScopedEntityCheckpoint(
    input: UpsertCustomerScopedEntityCheckpointInput,
    store: CustomerScopedHistoryProgressStore = getDefaultStore()
): Promise<CustomerScopedHistoryProgress> {
    const now = new Date().toISOString();
    const existing =
        (await getCustomerScopedHistoryProgress(input.connectorId, store)) ??
        ({
            connector_id: input.connectorId,
            account_id: input.accountId,
            customer_id: input.customerId,
            customer_number: input.customerNumber,
            entities: {},
            updated_at: now,
        } satisfies CustomerScopedHistoryProgress);

    if (
        existing.customer_id !== input.customerId ||
        existing.customer_number !== input.customerNumber
    ) {
        existing.customer_id = input.customerId;
        existing.customer_number = input.customerNumber;
        existing.entities = {};
    }

    const pageDone = input.pageComplete && input.backfillCursor == null;
    existing.entities[input.entityType] = {
        entity_type: input.entityType,
        backfill_cursor: input.backfillCursor,
        backfill_records_pulled: input.backfillRecordsPulled,
        backfill_total_records: input.backfillTotalRecords,
        backfill_completed: pageDone,
        last_error: input.lastError,
        last_checkpoint_at: now,
    };
    existing.account_id = input.accountId;
    existing.updated_at = now;
    await store.save(existing);
    return existing;
}

/**
 * True when every enabled entity has a completed checkpoint in isolated progress.
 */
export function isCustomerScopedHistoryComplete(
    progress: CustomerScopedHistoryProgress | null | undefined,
    enabledEntities: readonly string[]
): boolean {
    if (!progress || enabledEntities.length === 0) {
        return false;
    }
    return enabledEntities.every(
        (entityType) => progress.entities[entityType]?.backfill_completed === true
    );
}
