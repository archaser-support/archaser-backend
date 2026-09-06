import type {
    ImportCacheDocument,
    ImportCacheKey,
    SameDayCacheSummary,
    SaveEntityImportCacheInput,
} from "./types";

export interface ImportCacheStore {
    replace(input: SaveEntityImportCacheInput): Promise<{
        rowCount: number;
        chunkCount: number;
    }>;
    load(key: ImportCacheKey): Promise<ImportCacheDocument[]>;
    listSameDay(input: {
        accountId: number;
        syncMode: ImportCacheKey["syncMode"];
        cacheDay: string;
        customerScope: string;
    }): Promise<SameDayCacheSummary[]>;
}

export type { ImportCacheDocument, ImportCacheKey, SameDayCacheSummary };
