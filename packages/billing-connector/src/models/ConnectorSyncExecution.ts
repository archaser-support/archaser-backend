import mongoose, { Schema, Document, Model } from "mongoose";

export type ConnectorExecutionStatus =
    | "RUNNING"
    | "SUCCESS"
    | "FAILED"
    | "PARTIAL"
    | "TIMEOUT";

export type ConnectorSyncTrigger =
    | "scheduled"
    | "manual"
    | "preview"
    | "backfill";

export interface EntitySyncStats {
    pulled: number;
    success: number;
    failed: number;
    skipped: number;
}

export interface IConnectorSyncExecution extends Document {
    _id: mongoose.Types.ObjectId;
    connector_id: number;
    account_id: number;
    provider: string;
    trigger: ConnectorSyncTrigger;
    sync_mode: string;
    status: ConnectorExecutionStatus;
    started_at: Date;
    completed_at?: Date;
    duration_seconds?: number;
    correlation_id?: string;
    entity_stats?: Record<string, EntitySyncStats>;
    mapping_snapshot_hash?: Record<string, string>;
    import_job_ids?: Record<string, string>;
    error_message?: string;
    error_type?: string;
    error_details?: Record<string, unknown>;
    performance_metrics?: Record<string, unknown>;
    created_at: Date;
    modified_at: Date;
}

interface IConnectorSyncExecutionModel extends Model<IConnectorSyncExecution> {
    findByConnectorId(
        connectorId: number,
        limit?: number
    ): Promise<IConnectorSyncExecution[]>;
    findStaleRunning(
        connectorId: number,
        olderThan: Date
    ): Promise<IConnectorSyncExecution[]>;
    findLatestRunning(connectorId: number): Promise<IConnectorSyncExecution | null>;
}

const EntitySyncStatsSchema = new Schema(
    {
        pulled: { type: Number, default: 0 },
        success: { type: Number, default: 0 },
        failed: { type: Number, default: 0 },
        skipped: { type: Number, default: 0 },
    },
    { _id: false }
);

const ConnectorSyncExecutionSchema = new Schema(
    {
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
        correlation_id: { type: String, index: true, sparse: true },
        entity_stats: { type: Map, of: EntitySyncStatsSchema, default: {} },
        mapping_snapshot_hash: { type: Schema.Types.Mixed, default: null },
        import_job_ids: { type: Schema.Types.Mixed, default: null },
        error_message: { type: String, default: null },
        error_type: { type: String, default: null },
        error_details: { type: Schema.Types.Mixed, default: null },
        performance_metrics: { type: Schema.Types.Mixed, default: null },
    },
    {
        timestamps: { created_at: "created_at", modified_at: "modified_at" } as never,
        collection: "connector_sync_executions",
    }
);

ConnectorSyncExecutionSchema.index({ connector_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ account_id: 1, started_at: -1 });
ConnectorSyncExecutionSchema.index({ status: 1, started_at: 1 });
ConnectorSyncExecutionSchema.index(
    { started_at: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

ConnectorSyncExecutionSchema.statics.findByConnectorId = function (
    connectorId: number,
    limit = 50
) {
    return this.find({ connector_id: connectorId })
        .sort({ started_at: -1 })
        .limit(limit);
};

ConnectorSyncExecutionSchema.statics.findStaleRunning = function (
    connectorId: number,
    olderThan: Date
) {
    return this.find({
        connector_id: connectorId,
        status: "RUNNING",
        started_at: { $lt: olderThan },
    }).sort({ started_at: -1 });
};

ConnectorSyncExecutionSchema.statics.findLatestRunning = function (
    connectorId: number
) {
    return this.findOne({
        connector_id: connectorId,
        status: "RUNNING",
    }).sort({ started_at: -1 });
};

const ConnectorSyncExecution: IConnectorSyncExecutionModel =
    (mongoose.models.ConnectorSyncExecution as IConnectorSyncExecutionModel) ||
    mongoose.model<IConnectorSyncExecution, IConnectorSyncExecutionModel>(
        "ConnectorSyncExecution",
        ConnectorSyncExecutionSchema
    );

export default ConnectorSyncExecution;
