export type ImportCacheEntityType =
    | "Customer"
    | "Contact"
    | "Invoice"
    | "Payment";

export type ImportCacheSyncMode = "BACKFILL" | "INCREMENTAL";

/** Full-account runs use this sentinel so scoped runs never collide. */
export const IMPORT_CACHE_CUSTOMER_SCOPE_ALL = "all";

/** Default when BillingConnector.time_zone is unset / invalid. */
export const DEFAULT_IMPORT_CACHE_TIME_ZONE = "Asia/Jerusalem";

/** Keep BSON docs under Mongo’s 16MB limit with headroom. */
export const IMPORT_CACHE_MAX_CHUNK_BYTES = 10 * 1024 * 1024;

export const IMPORT_CACHE_TTL_SECONDS = 180 * 24 * 60 * 60;

export const IMPORT_CACHE_ENTITY_TYPES: ImportCacheEntityType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

export interface ImportCacheKey {
    accountId: number;
    executionId: string;
    importType: ImportCacheEntityType;
    syncMode: ImportCacheSyncMode;
    cacheDay: string;
    customerScope: string;
}

export interface SaveEntityImportCacheInput extends ImportCacheKey {
    connectorId: number;
    provider: string;
    rows: Record<string, unknown>[];
}

export interface ImportCacheChunkMeta {
    account_id: number;
    connector_id: number;
    provider: string;
    import_type: ImportCacheEntityType;
    sync_mode: ImportCacheSyncMode;
    cache_day: string;
    customer_scope: string;
    execution_id: string;
    row_count: number;
    chunk_index: number;
    chunk_count: number;
    created_at: Date;
}

export interface ImportCacheDocument extends ImportCacheChunkMeta {
    rows: Record<string, unknown>[];
}

/** @deprecated Prefer SameDayCacheRun — v1 per-entity summary. */
export interface SameDayCacheSummary {
    import_type: ImportCacheEntityType;
    sync_mode: ImportCacheSyncMode;
    cache_day: string;
    customer_scope: string;
    row_count: number;
    execution_id: string | null;
    created_at: Date;
    available: true;
}

export interface SameDayCacheRunEntity {
    import_type: ImportCacheEntityType;
    row_count: number;
    available: boolean;
}

/** One successful sync run’s backups for today (may be incomplete). */
export interface SameDayCacheRun {
    execution_id: string;
    created_at: Date;
    sync_mode: ImportCacheSyncMode;
    cache_day: string;
    customer_scope: string;
    entities: SameDayCacheRunEntity[];
}
