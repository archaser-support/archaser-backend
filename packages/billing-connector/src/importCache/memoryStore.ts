import { chunkImportCacheRows } from "./cacheDay";
import type { ImportCacheLoadKey, ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_ENTITY_TYPES,
    IMPORT_CACHE_MAX_CHUNK_BYTES,
    type ImportCacheDaySummary,
    type ImportCacheDocument,
    type ImportCacheEntityType,
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

        async load(key: ImportCacheLoadKey): Promise<ImportCacheDocument[]> {
            const docs = byExecutionEntity.get(executionEntityKey(key)) ?? [];
            return docs.filter((doc) => {
                if (
                    doc.sync_mode !== key.syncMode ||
                    doc.customer_scope !== key.customerScope
                ) {
                    return false;
                }
                if (
                    typeof key.cacheDay === "string" &&
                    key.cacheDay.trim().length > 0 &&
                    doc.cache_day !== key.cacheDay.trim()
                ) {
                    return false;
                }
                return true;
            });
        },

        async listSameDayRuns(input): Promise<SameDayCacheRun[]> {
            const byExecution = new Map<
                string,
                {
                    created_at: Date;
                    entities: Map<ImportCacheEntityType, { row_count: number }>;
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
                if (
                    !IMPORT_CACHE_ENTITY_TYPES.includes(
                        first.import_type as ImportCacheEntityType
                    )
                ) {
                    continue;
                }
                run.entities.set(first.import_type as ImportCacheEntityType, {
                    row_count: first.row_count,
                });
            }

            const runs: SameDayCacheRun[] = [];
            for (const [execution_id, run] of byExecution) {
                if (run.entities.size === 0) {
                    continue;
                }
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

        async listCacheDays(input): Promise<ImportCacheDaySummary[]> {
            const importTypes =
                input.importTypes && input.importTypes.length > 0
                    ? new Set(input.importTypes)
                    : new Set(IMPORT_CACHE_ENTITY_TYPES);
            const byDay = new Map<string, Set<string>>();

            for (const docs of byExecutionEntity.values()) {
                const first = docs[0];
                if (!first) continue;
                if (
                    first.account_id !== input.accountId ||
                    first.sync_mode !== input.syncMode ||
                    first.customer_scope !== input.customerScope
                ) {
                    continue;
                }
                if (
                    !IMPORT_CACHE_ENTITY_TYPES.includes(
                        first.import_type as ImportCacheEntityType
                    ) ||
                    !importTypes.has(first.import_type as ImportCacheEntityType)
                ) {
                    continue;
                }
                let executions = byDay.get(first.cache_day);
                if (!executions) {
                    executions = new Set();
                    byDay.set(first.cache_day, executions);
                }
                executions.add(first.execution_id);
            }

            return Array.from(byDay.entries())
                .map(([cache_day, executions]) => ({
                    cache_day,
                    run_count: executions.size,
                }))
                .sort((a, b) => b.cache_day.localeCompare(a.cache_day));
        },
    };
}
