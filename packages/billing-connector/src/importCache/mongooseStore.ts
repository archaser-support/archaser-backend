import { ensureMongoConnection } from "../syncHistory/mongooseConnection";
import {
    chunkImportCacheRows,
} from "./cacheDay";
import { ConnectorImportEntityCacheModel } from "./model";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_MAX_CHUNK_BYTES,
    type ImportCacheDocument,
    type ImportCacheKey,
    type SameDayCacheSummary,
    type SaveEntityImportCacheInput,
} from "./types";

function keyFilter(key: ImportCacheKey) {
    return {
        account_id: key.accountId,
        import_type: key.importType,
        sync_mode: key.syncMode,
        cache_day: key.cacheDay,
        customer_scope: key.customerScope,
    };
}

export const mongooseImportCacheStore: ImportCacheStore = {
    async replace(input: SaveEntityImportCacheInput) {
        await ensureMongoConnection();
        const chunks = chunkImportCacheRows(
            input.rows,
            IMPORT_CACHE_MAX_CHUNK_BYTES
        );
        const filter = keyFilter(input);
        await ConnectorImportEntityCacheModel.deleteMany(filter);
        const createdAt = new Date();
        const docs = chunks.map((rows, chunkIndex) => ({
            ...filter,
            connector_id: input.connectorId,
            provider: input.provider,
            execution_id: input.executionId,
            row_count: input.rows.length,
            chunk_index: chunkIndex,
            chunk_count: chunks.length,
            rows,
            created_at: createdAt,
            modified_at: createdAt,
        }));
        if (docs.length > 0) {
            await ConnectorImportEntityCacheModel.insertMany(docs);
        }
        return { rowCount: input.rows.length, chunkCount: chunks.length };
    },

    async load(key: ImportCacheKey): Promise<ImportCacheDocument[]> {
        await ensureMongoConnection();
        const docs = await ConnectorImportEntityCacheModel.find(keyFilter(key))
            .sort({ chunk_index: 1 })
            .lean();
        return docs.map((doc) => ({
            account_id: doc.account_id,
            connector_id: doc.connector_id,
            provider: doc.provider,
            import_type: doc.import_type,
            sync_mode: doc.sync_mode,
            cache_day: doc.cache_day,
            customer_scope: doc.customer_scope,
            execution_id: doc.execution_id ?? null,
            row_count: doc.row_count,
            chunk_index: doc.chunk_index,
            chunk_count: doc.chunk_count,
            rows: (doc.rows ?? []) as Record<string, unknown>[],
            created_at: doc.created_at,
        }));
    },

    async listSameDay(input): Promise<SameDayCacheSummary[]> {
        await ensureMongoConnection();
        const docs = await ConnectorImportEntityCacheModel.find({
            account_id: input.accountId,
            sync_mode: input.syncMode,
            cache_day: input.cacheDay,
            customer_scope: input.customerScope,
            chunk_index: 0,
        })
            .sort({ import_type: 1 })
            .lean();
        return docs.map((doc) => ({
            import_type: doc.import_type,
            sync_mode: doc.sync_mode,
            cache_day: doc.cache_day,
            customer_scope: doc.customer_scope,
            row_count: doc.row_count,
            execution_id: doc.execution_id ?? null,
            created_at: doc.created_at,
            available: true as const,
        }));
    },
};
