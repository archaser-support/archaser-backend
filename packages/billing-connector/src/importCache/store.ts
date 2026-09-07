import type {
    ImportCacheDocument,
    ImportCacheKey,
    SameDayCacheRun,
    SaveEntityImportCacheInput,
} from "./types";

export interface ImportCacheStore {
    /**
     * Persist (or re-persist) one entity backup for an execution.
     * Does not delete other executions’ same-day documents.
     */
    save(input: SaveEntityImportCacheInput): Promise<{
        rowCount: number;
        chunkCount: number;
    }>;
    load(key: ImportCacheKey): Promise<ImportCacheDocument[]>;
    listSameDayRuns(input: {
        accountId: number;
        syncMode: ImportCacheKey["syncMode"];
        cacheDay: string;
        customerScope: string;
    }): Promise<SameDayCacheRun[]>;
}

export type { ImportCacheDocument, ImportCacheKey, SameDayCacheRun };
