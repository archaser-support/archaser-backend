import mongoose, { Schema, type Document, type Model } from "mongoose";

import type {
    ConnectorExecutionStatus,
    ConnectorSyncTrigger,
    SyncHistoryEntityStats,
} from "./types";

export interface IConnectorSyncExecutionDoc extends Document {
    execution_id: string;
    connector_id: number;
    account_id: number;
    provider: string;
    trigger: ConnectorSyncTrigger;
    sync_mode: string;
    status: ConnectorExecutionStatus;
    started_at: Date;
    completed_at?: Date | null;
    duration_seconds?: number | null;
    entity_stats?: SyncHistoryEntityStats;
    error_message?: string | null;
    error_type?: string | null;
    created_at: Date;
    modified_at: Date;
}

const ConnectorSyncExecutionSchema = new Schema(
    {
        execution_id: { type: String, required: true },
        connector_id: { type: Number, required: true, index: true },
        account_id: { type: Number, required: true, index: true },
        provider: { type: String, required: true },
        trigger: {
            type: String,
            required: true,
            enum: ["scheduled", "manual", "preview", "backfill"],
        },
        sync_mode: { type: String, required: true },
        status: {
            type: String,
            required: true,
            enum: ["RUNNING", "SUCCESS", "FAILED", "PARTIAL", "TIMEOUT"],
            index: true,
        },
        started_at: { type: Date, required: true, default: Date.now },
        completed_at: { type: Date, default: null },
        duration_seconds: { type: Number, default: null },
        // Mixed so `_maturity` may carry status / sample_errors on finish.
        entity_stats: { type: Schema.Types.Mixed, default: {} },
        error_message: { type: String, default: null },
        error_type: { type: String, default: null },
    },
    {
        timestamps: {
            createdAt: "created_at",
            updatedAt: "modified_at",
        },
        collection: "connector_sync_executions",
    }
);

ConnectorSyncExecutionSchema.index(
    { execution_id: 1 },
    { unique: true, sparse: true }
);
ConnectorSyncExecutionSchema.index({ connector_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ account_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ status: 1, started_at: 1 });
ConnectorSyncExecutionSchema.index(
    { started_at: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

export const ConnectorSyncExecutionModel: Model<IConnectorSyncExecutionDoc> =
    (mongoose.models.ConnectorSyncExecution as Model<IConnectorSyncExecutionDoc>) ||
    mongoose.model<IConnectorSyncExecutionDoc>(
        "ConnectorSyncExecution",
        ConnectorSyncExecutionSchema
    );
