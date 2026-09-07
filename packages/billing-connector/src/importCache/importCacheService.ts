import { resolveImportCacheDay } from "./cacheDay";
import { createMemoryImportCacheStore } from "./memoryStore";
import { mongooseImportCacheStore } from "./mongooseStore";
import type { ImportCacheStore } from "./store";
import type {
    ImportCacheDocument,
    ImportCacheKey,
    SameDayCacheRun,
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

function requireExecutionId(executionId: string | null | undefined): string {
    if (typeof executionId !== "string" || executionId.trim().length === 0) {
        throw new Error(
            "IMPORT_CACHE_EXECUTION_ID_REQUIRED: execution_id is required to save import cache"
        );
    }
    return executionId.trim();
}

export async function saveEntityImportCache(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    }
): Promise<{ rowCount: number; chunkCount: number }> {
    const executionId = requireExecutionId(input.executionId);
    return store.save({ ...input, executionId });
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

export async function findSameDayCacheRuns(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<SameDayCacheRun[]> {
    const cacheDay = resolveImportCacheDay(input.at, input.timeZone);
    const customerScope =
        typeof input.customerScope === "string" &&
        input.customerScope.trim().length > 0
            ? input.customerScope.trim()
            : "all";
    return store.listSameDayRuns({
        accountId: input.accountId,
        syncMode: input.syncMode,
        cacheDay,
        customerScope,
    });
}

/** @deprecated Use findSameDayCacheRuns — kept for transitional callers. */
export async function findSameDayCaches(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<
    Array<{
        import_type: ImportCacheKey["importType"];
        sync_mode: ImportCacheKey["syncMode"];
        cache_day: string;
        customer_scope: string;
        row_count: number;
        execution_id: string | null;
        created_at: Date;
        available: true;
    }>
> {
    const runs = await findSameDayCacheRuns(input);
    const out: Array<{
        import_type: ImportCacheKey["importType"];
        sync_mode: ImportCacheKey["syncMode"];
        cache_day: string;
        customer_scope: string;
        row_count: number;
        execution_id: string | null;
        created_at: Date;
        available: true;
    }> = [];
    for (const run of runs) {
        for (const entity of run.entities) {
            if (!entity.available) continue;
            out.push({
                import_type: entity.import_type,
                sync_mode: run.sync_mode,
                cache_day: run.cache_day,
                customer_scope: run.customer_scope,
                row_count: entity.row_count,
                execution_id: run.execution_id,
                created_at: run.created_at,
                available: true,
            });
        }
    }
    return out;
}

export type LoadImportCachesForReplayResult =
    | {
          ok: true;
          cacheDay: string;
          customerScope: string;
          executionId: string;
          rowsByEntity: Map<
              ImportCacheKey["importType"],
              Record<string, unknown>[]
          >;
      }
    | {
          ok: false;
          cacheDay: string;
          customerScope: string;
          executionId: string;
          missing: ImportCacheKey["importType"][];
      };

/** @deprecated Alias for LoadImportCachesForReplayResult. */
export type LoadSameDayImportCachesResult = LoadImportCachesForReplayResult;

/**
 * Load backups for the requested entities on a specific execution.
 * Missing keys fail clearly (no silent ERP fallback). Empty row arrays are
 * valid when a backup exists (including zero-row successes).
 */
export async function loadImportCachesForReplay(input: {
    accountId: number;
    executionId: string;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheKey["importType"][];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<LoadImportCachesForReplayResult> {
    const executionId = requireExecutionId(input.executionId);
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
            executionId,
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
        return {
            ok: false,
            cacheDay,
            customerScope,
            executionId,
            missing,
        };
    }
    return { ok: true, cacheDay, customerScope, executionId, rowsByEntity };
}

/** @deprecated Use loadImportCachesForReplay with executionId. */
export async function loadSameDayImportCachesForReplay(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheKey["importType"][];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
    executionId?: string | null;
}): Promise<LoadImportCachesForReplayResult> {
    if (
        typeof input.executionId !== "string" ||
        input.executionId.trim().length === 0
    ) {
        return {
            ok: false,
            cacheDay: resolveImportCacheDay(input.at, input.timeZone),
            customerScope:
                typeof input.customerScope === "string" &&
                input.customerScope.trim().length > 0
                    ? input.customerScope.trim()
                    : "all",
            executionId: "",
            missing: [...input.importTypes],
        };
    }
    return loadImportCachesForReplay({
        ...input,
        executionId: input.executionId,
    });
}

/**
 * Persist import cache after entity success. Throws on missing execution_id
 * or Mongo failure so callers can fail the entity and stop later entities.
 */
export async function saveEntityImportCacheOrThrow(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    },
    onLog?: (message: string) => void
): Promise<void> {
    const result = await saveEntityImportCache(input);
    onLog?.(
        `Import cache saved ${input.importType} ${input.syncMode} day=${input.cacheDay} scope=${input.customerScope} execution=${String(input.executionId)} rows=${result.rowCount} chunks=${result.chunkCount}`
    );
}

/**
 * @deprecated Best-effort write — prefer saveEntityImportCacheOrThrow (D2/D3).
 */
export async function trySaveEntityImportCache(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    },
    onLog?: (message: string) => void
): Promise<void> {
    try {
        await saveEntityImportCacheOrThrow(input, onLog);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(
            `Import cache save failed for ${input.importType}: ${message}`
        );
    }
}
