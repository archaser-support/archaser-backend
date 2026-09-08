import { ensureMongoConnection } from "../syncHistory/mongooseConnection";
import { chunkImportCacheRows } from "./cacheDay";
import {
    ConnectorImportEntityCacheModel,
    IMPORT_CACHE_V1_UNIQUE_INDEX_NAME,
} from "./model";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_ENTITY_TYPES,
    IMPORT_CACHE_MAX_CHUNK_BYTES,
    type ImportCacheDocument,
    type ImportCacheKey,
    type SameDayCacheRun,
    type SaveEntityImportCacheInput,
} from "./types";

let indexesEnsured = false;

/**
 * Drop the v1 same-day unique index and ensure multi-run indexes exist.
 * Safe to call repeatedly; no-ops after the first successful pass.
 */
export async function ensureImportCacheIndexes(): Promise<void> {
    if (indexesEnsured) {
        return;
    }
    await ensureMongoConnection();
    const collection = ConnectorImportEntityCacheModel.collection;
    try {
        await collection.dropIndex(IMPORT_CACHE_V1_UNIQUE_INDEX_NAME);
    } catch (err) {
        const code =
            err && typeof err === "object" && "code" in err
                ? (err as { code?: number }).code
                : undefined;
        const message = err instanceof Error ? err.message : String(err);
        // 27 = IndexNotFound
        if (code !== 27 && !/index not found/i.test(message)) {
            throw err;
        }
    }
    await ConnectorImportEntityCacheModel.syncIndexes();
    indexesEnsured = true;
}

/** Test helper — allow re-running index ensure after model changes. */
export function resetImportCacheIndexesEnsuredForTests(): void {
    indexesEnsured = false;
}

function executionEntityFilter(input: {
    accountId: number;
    executionId: string;
    importType: ImportCacheKey["importType"];
}) {
    return {
        account_id: input.accountId,
        execution_id: input.executionId,
        import_type: input.importType,
    };
}

function keyFilter(key: ImportCacheKey) {
    return {
        account_id: key.accountId,
        execution_id: key.executionId,
        import_type: key.importType,
        sync_mode: key.syncMode,
        cache_day: key.cacheDay,
        customer_scope: key.customerScope,
    };
}

export const mongooseImportCacheStore: ImportCacheStore = {
    async save(input: SaveEntityImportCacheInput) {
        await ensureImportCacheIndexes();
        const chunks = chunkImportCacheRows(
            input.rows,
            IMPORT_CACHE_MAX_CHUNK_BYTES
        );
        const filter = executionEntityFilter(input);
        // Idempotent re-write for the same execution+entity; other runs stay.
        await ConnectorImportEntityCacheModel.deleteMany(filter);
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
            modified_at: createdAt,
        }));
        if (docs.length > 0) {
            await ConnectorImportEntityCacheModel.insertMany(docs);
        }
        return { rowCount: input.rows.length, chunkCount: chunks.length };
    },

    async load(key: ImportCacheKey): Promise<ImportCacheDocument[]> {
        await ensureImportCacheIndexes();
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
            execution_id: doc.execution_id,
            row_count: doc.row_count,
            chunk_index: doc.chunk_index,
            chunk_count: doc.chunk_count,
            rows: (doc.rows ?? []) as Record<string, unknown>[],
            created_at: doc.created_at,
        }));
    },

    async listSameDayRuns(input): Promise<SameDayCacheRun[]> {
        await ensureImportCacheIndexes();
        const docs = await ConnectorImportEntityCacheModel.find({
            account_id: input.accountId,
            sync_mode: input.syncMode,
            cache_day: input.cacheDay,
            customer_scope: input.customerScope,
            chunk_index: 0,
        })
            .sort({ created_at: -1 })
            .lean();

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

        for (const doc of docs) {
            const executionId = doc.execution_id;
            if (typeof executionId !== "string" || executionId.length === 0) {
                continue;
            }
            let run = byExecution.get(executionId);
            if (!run) {
                run = {
                    created_at: doc.created_at,
                    entities: new Map(),
                };
                byExecution.set(executionId, run);
            } else if (doc.created_at > run.created_at) {
                run.created_at = doc.created_at;
            }
            // Skip internal PendingInvoiceClose — not a Start picker entity.
            if (
                !IMPORT_CACHE_ENTITY_TYPES.includes(
                    doc.import_type as (typeof IMPORT_CACHE_ENTITY_TYPES)[number]
                )
            ) {
                continue;
            }
            run.entities.set(doc.import_type as (typeof IMPORT_CACHE_ENTITY_TYPES)[number], {
                row_count: doc.row_count,
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

        runs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
        return runs;
    },
};
