import { chunkImportCacheRows } from "./cacheDay";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_MAX_CHUNK_BYTES,
    type ImportCacheDocument,
    type ImportCacheKey,
    type SameDayCacheSummary,
    type SaveEntityImportCacheInput,
} from "./types";

function keyString(key: ImportCacheKey): string {
    return [
        key.accountId,
        key.importType,
        key.syncMode,
        key.cacheDay,
        key.customerScope,
    ].join("|");
}

export function createMemoryImportCacheStore(): ImportCacheStore {
    const byKey = new Map<string, ImportCacheDocument[]>();

    return {
        async replace(input: SaveEntityImportCacheInput) {
            const chunks = chunkImportCacheRows(
                input.rows,
                IMPORT_CACHE_MAX_CHUNK_BYTES
            );
            const createdAt = new Date();
            const docs = chunks.map((rows, chunkIndex) => ({
                account_id: input.accountId,
                connector_id: input.connectorId,
                provider: input.provider,
                import_type: input.importType,
                sync_mode: input.syncMode,
                cache_day: input.cacheDay,
                customer_scope: input.customerScope,
                execution_id: input.executionId,
                row_count: input.rows.length,
                chunk_index: chunkIndex,
                chunk_count: chunks.length,
                rows,
                created_at: createdAt,
            }));
            byKey.set(keyString(input), docs);
            return { rowCount: input.rows.length, chunkCount: chunks.length };
        },

        async load(key: ImportCacheKey): Promise<ImportCacheDocument[]> {
            return [...(byKey.get(keyString(key)) ?? [])];
        },

        async listSameDay(input): Promise<SameDayCacheSummary[]> {
            const out: SameDayCacheSummary[] = [];
            for (const docs of byKey.values()) {
                const first = docs[0];
                if (!first) continue;
                if (
                    first.account_id !== input.accountId ||
                    first.sync_mode !== input.syncMode ||
                    first.cache_day !== input.cacheDay ||
                    first.customer_scope !== input.customerScope
                ) {
                    continue;
                }
                out.push({
                    import_type: first.import_type,
                    sync_mode: first.sync_mode,
                    cache_day: first.cache_day,
                    customer_scope: first.customer_scope,
                    row_count: first.row_count,
                    execution_id: first.execution_id,
                    created_at: first.created_at,
                    available: true,
                });
            }
            return out.sort((a, b) =>
                a.import_type.localeCompare(b.import_type)
            );
        },
    };
}
