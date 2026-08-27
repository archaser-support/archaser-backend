import { type Document, type Model } from "mongoose";
import type { ConnectorExecutionStatus, ConnectorSyncTrigger, SyncHistoryEntityStats } from "./types";
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
export declare const ConnectorSyncExecutionModel: Model<IConnectorSyncExecutionDoc>;
