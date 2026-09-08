import { chunkImportCacheRows } from "./cacheDay";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_ENTITY_TYPES,
    IMPORT_CACHE_MAX_CHUNK_BYTES,
    type ImportCacheDocument,
    type ImportCacheKey,
    type SameDayCacheRun,
    type SaveEntityImportCacheInput,
} from "./types";

function executionEntityKey(input: {
    accountId: number;
    executionId: string;
    importType: ImportCacheKey["importType"];
}): string {
    return `${input.accountId}|${input.executionId}|${input.importType}`;
}

export function createMemoryImportCacheStore(): ImportCacheStore {
    const byExecutionEntity = new Map<string, ImportCacheDocument[]>();

    return {
        async save(input: SaveEntityImportCacheInput) {
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
            byExecutionEntity.set(executionEntityKey(input), docs);
            return { rowCount: input.rows.length, chunkCount: chunks.length };
        },

        async load(key: ImportCacheKey): Promise<ImportCacheDocument[]> {
            const docs = byExecutionEntity.get(executionEntityKey(key)) ?? [];
            return docs.filter(
                (doc) =>
                    doc.sync_mode === key.syncMode &&
                    doc.cache_day === key.cacheDay &&
                    doc.customer_scope === key.customerScope
            );
        },

        async listSameDayRuns(input): Promise<SameDayCacheRun[]> {
            const byExecution = new Map<
                string,
                {
                    created_at: Date;
                    entities: Map<
                        ImportCacheKey["importType"],
                        { row_count: number }
                    >;
                }
            >();

            for (const docs of byExecutionEntity.values()) {
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
                let run = byExecution.get(first.execution_id);
                if (!run) {
                    run = {
                        created_at: first.created_at,
                        entities: new Map(),
                    };
                    byExecution.set(first.execution_id, run);
                } else if (first.created_at > run.created_at) {
                    run.created_at = first.created_at;
                }
                run.entities.set(first.import_type, {
                    row_count: first.row_count,
                });
            }

            const runs: SameDayCacheRun[] = [];
            for (const [execution_id, run] of byExecution) {
                runs.push({
                    execution_id,
                    created_at: run.created_at,
                    sync_mode: input.syncMode,
                    cache_day: input.cacheDay,
                    customer_scope: input.customerScope,
                    entities: IMPORT_CACHE_ENTITY_TYPES.map((import_type) => {
                        const hit = run.entities.get(import_type);
                        if (!hit) {
                            return {
                                import_type,
                                row_count: 0,
                                available: false,
                            };
                        }
                        return {
                            import_type,
                            row_count: hit.row_count,
                            available: true,
                        };
                    }),
                });
            }
            runs.sort(
                (a, b) => b.created_at.getTime() - a.created_at.getTime()
            );
            return runs;
        },
    };
}
