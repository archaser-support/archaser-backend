import mongoose, { Document, Model } from "mongoose";
export type ConnectorExecutionStatus = "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL" | "TIMEOUT";
export type ConnectorSyncTrigger = "scheduled" | "manual" | "preview" | "backfill";
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
    findByConnectorId(connectorId: number, limit?: number): Promise<IConnectorSyncExecution[]>;
    findStaleRunning(connectorId: number, olderThan: Date): Promise<IConnectorSyncExecution[]>;
    findLatestRunning(connectorId: number): Promise<IConnectorSyncExecution | null>;
}
declare const ConnectorSyncExecution: IConnectorSyncExecutionModel;
export default ConnectorSyncExecution;
