import mongoose, { Schema, type Document, type Model } from "mongoose";

import {
    IMPORT_CACHE_TTL_SECONDS,
    type ImportCacheEntityType,
    type ImportCacheSyncMode,
} from "./types";

export interface IConnectorImportEntityCacheDoc extends Document {
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
    rows: Record<string, unknown>[];
    created_at: Date;
    modified_at: Date;
}

/** v1 unique index — must be dropped so same-day multi-run can append. */
export const IMPORT_CACHE_V1_UNIQUE_INDEX_NAME =
    "account_id_1_import_type_1_sync_mode_1_cache_day_1_customer_scope_1_chunk_index_1";

const ConnectorImportEntityCacheSchema = new Schema(
    {
        account_id: { type: Number, required: true, index: true },
        connector_id: { type: Number, required: true, index: true },
        provider: { type: String, required: true },
        import_type: {
            type: String,
            required: true,
            enum: ["Customer", "Contact", "Invoice", "Payment"],
        },
        sync_mode: {
            type: String,
            required: true,
            enum: ["BACKFILL", "INCREMENTAL"],
        },
        cache_day: { type: String, required: true },
        customer_scope: { type: String, required: true, default: "all" },
        execution_id: { type: String, required: true },
        row_count: { type: Number, required: true, default: 0 },
        chunk_index: { type: Number, required: true, default: 0 },
        chunk_count: { type: Number, required: true, default: 1 },
        rows: { type: [Schema.Types.Mixed], default: [] },
    },
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "modified_at",
        },
        collection: "connector_import_entity_cache",
    }
);

/** Multi-run uniqueness: one backup (chunked) per execution + entity. */
ConnectorImportEntityCacheSchema.index(
    {
        account_id: 1,
        execution_id: 1,
        import_type: 1,
        chunk_index: 1,
    },
    { unique: true }
);
/** Listing today’s runs by mode + customer scope. */
ConnectorImportEntityCacheSchema.index({
    account_id: 1,
    sync_mode: 1,
    cache_day: 1,
    customer_scope: 1,
});
ConnectorImportEntityCacheSchema.index(
    { created_at: 1 },
    { expireAfterSeconds: IMPORT_CACHE_TTL_SECONDS }
);

export const ConnectorImportEntityCacheModel: Model<IConnectorImportEntityCacheDoc> =
    (mongoose.models
        .ConnectorImportEntityCache as Model<IConnectorImportEntityCacheDoc>) ||
    mongoose.model<IConnectorImportEntityCacheDoc>(
        "ConnectorImportEntityCache",
        ConnectorImportEntityCacheSchema
    );
