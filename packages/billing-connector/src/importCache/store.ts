import type {
    ImportCacheDocument,
    ImportCacheDaySummary,
    ImportCacheEntityType,
    ImportCacheKey,
    SameDayCacheRun,
    SaveEntityImportCacheInput,
} from "./types";

/** Load by execution; `cacheDay` is optional (H4 — prior-day replay). */
export type ImportCacheLoadKey = Omit<ImportCacheKey, "cacheDay"> & {
    cacheDay?: string;
};

export interface ImportCacheStore {
    /**
     * Persist (or re-persist) one entity backup for an execution.
     * Does not delete other executions’ same-day documents.
     */
    save(input: SaveEntityImportCacheInput): Promise<{
        rowCount: number;
        chunkCount: number;
    }>;
    load(key: ImportCacheLoadKey): Promise<ImportCacheDocument[]>;
    listSameDayRuns(input: {
        accountId: number;
        syncMode: ImportCacheKey["syncMode"];
        cacheDay: string;
        customerScope: string;
    }): Promise<SameDayCacheRun[]>;
    /** Distinct cache days (newest first) with ≥1 selectable entity in TTL. */
    listCacheDays(input: {
        accountId: number;
        syncMode: ImportCacheKey["syncMode"];
        customerScope: string;
        importTypes?: ImportCacheEntityType[];
    }): Promise<ImportCacheDaySummary[]>;
}

export type {
    ImportCacheDocument,
    ImportCacheDaySummary,
    ImportCacheKey,
    SameDayCacheRun,
};
