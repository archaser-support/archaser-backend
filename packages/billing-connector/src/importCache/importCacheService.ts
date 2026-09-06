import { resolveImportCacheDay } from "./cacheDay";
import { createMemoryImportCacheStore } from "./memoryStore";
import { mongooseImportCacheStore } from "./mongooseStore";
import type { ImportCacheStore } from "./store";
import type {
    ImportCacheDocument,
    ImportCacheKey,
    SameDayCacheSummary,
    SaveEntityImportCacheInput,
} from "./types";

let store: ImportCacheStore = mongooseImportCacheStore;

export function useMemoryImportCacheStoreForTests(
    memoryStore: ImportCacheStore = createMemoryImportCacheStore()
): ImportCacheStore {
    store = memoryStore;
    return memoryStore;
}

export function resetImportCacheStoreForTests(): void {
    store = mongooseImportCacheStore;
}

export async function saveEntityImportCache(
    input: SaveEntityImportCacheInput
): Promise<{ rowCount: number; chunkCount: number }> {
    return store.replace(input);
}

export async function loadEntityImportCache(
    key: ImportCacheKey
): Promise<Record<string, unknown>[]> {
    const docs = await store.load(key);
    const rows: Record<string, unknown>[] = [];
    for (const doc of docs) {
        rows.push(...doc.rows);
    }
    return rows;
}

export async function loadEntityImportCacheDocuments(
    key: ImportCacheKey
): Promise<ImportCacheDocument[]> {
    return store.load(key);
}

export async function findSameDayCaches(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<SameDayCacheSummary[]> {
    const cacheDay = resolveImportCacheDay(input.at, input.timeZone);
    const customerScope =
        typeof input.customerScope === "string" &&
        input.customerScope.trim().length > 0
            ? input.customerScope.trim()
            : "all";
    return store.listSameDay({
        accountId: input.accountId,
        syncMode: input.syncMode,
        cacheDay,
        customerScope,
    });
}

/**
 * Best-effort write used by sync runners — never fail the import because Mongo
 * cache persistence failed.
 */
export async function trySaveEntityImportCache(
    input: SaveEntityImportCacheInput,
    onLog?: (message: string) => void
): Promise<void> {
    try {
        const result = await saveEntityImportCache(input);
        onLog?.(
            `Import cache saved ${input.importType} ${input.syncMode} day=${input.cacheDay} scope=${input.customerScope} rows=${result.rowCount} chunks=${result.chunkCount}`
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(
            `Import cache save failed for ${input.importType}: ${message}`
        );
    }
}
