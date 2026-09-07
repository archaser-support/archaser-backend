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

export type LoadSameDayImportCachesResult =
    | {
          ok: true;
          cacheDay: string;
          customerScope: string;
          rowsByEntity: Map<
              ImportCacheKey["importType"],
              Record<string, unknown>[]
          >;
      }
    | {
          ok: false;
          cacheDay: string;
          customerScope: string;
          missing: ImportCacheKey["importType"][];
      };

/**
 * Load same-day backups for the requested entities. Missing keys fail clearly
 * (no silent ERP fallback). Empty row arrays are valid when a backup exists.
 */
export async function loadSameDayImportCachesForReplay(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheKey["importType"][];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<LoadSameDayImportCachesResult> {
    const cacheDay = resolveImportCacheDay(input.at, input.timeZone);
    const customerScope =
        typeof input.customerScope === "string" &&
        input.customerScope.trim().length > 0
            ? input.customerScope.trim()
            : "all";
    const rowsByEntity = new Map<
        ImportCacheKey["importType"],
        Record<string, unknown>[]
    >();
    const missing: ImportCacheKey["importType"][] = [];
    for (const importType of input.importTypes) {
        const docs = await store.load({
            accountId: input.accountId,
            importType,
            syncMode: input.syncMode,
            cacheDay,
            customerScope,
        });
        if (docs.length === 0) {
            missing.push(importType);
            continue;
        }
        const rows: Record<string, unknown>[] = [];
        for (const doc of docs) {
            rows.push(...doc.rows);
        }
        rowsByEntity.set(importType, rows);
    }
    if (missing.length > 0) {
        return { ok: false, cacheDay, customerScope, missing };
    }
    return { ok: true, cacheDay, customerScope, rowsByEntity };
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
