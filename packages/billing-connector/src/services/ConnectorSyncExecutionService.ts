import { createHash } from "crypto";

import { ensureMongoConnection } from "@/lib/mongoose";
import ConnectorSyncExecution, {
    type ConnectorExecutionStatus,
    type ConnectorSyncTrigger,
    type EntitySyncStats,
    type IConnectorSyncExecution,
} from "@/models/ConnectorSyncExecution";

export class ConnectorSyncExecutionService {
    static async createExecution(data: {
        connectorId: number;
        accountId: number;
        provider: string;
        trigger: ConnectorSyncTrigger;
        syncMode: string;
        correlationId?: string;
        mappingSnapshotHash?: Record<string, string>;
    }): Promise<IConnectorSyncExecution> {
        await ensureMongoConnection();

        const execution = new ConnectorSyncExecution({
            connector_id: data.connectorId,
            account_id: data.accountId,
            provider: data.provider,
            trigger: data.trigger,
            sync_mode: data.syncMode,
            status: "RUNNING",
            started_at: new Date(),
            correlation_id: data.correlationId,
            mapping_snapshot_hash: data.mappingSnapshotHash,
            entity_stats: {},
        });

        return execution.save();
    }

    static async updateExecution(
        executionId: string,
        data: {
            status?: ConnectorExecutionStatus;
            completedAt?: Date;
            durationSeconds?: number;
            entityStats?: Record<string, EntitySyncStats>;
            importJobIds?: Record<string, string>;
            errorMessage?: string;
            errorType?: string;
            errorDetails?: Record<string, unknown>;
            performanceMetrics?: Record<string, unknown>;
        }
    ): Promise<IConnectorSyncExecution | null> {
        await ensureMongoConnection();

        const update: Record<string, unknown> = { modified_at: new Date() };
        if (data.status !== undefined) update.status = data.status;
        if (data.completedAt !== undefined) update.completed_at = data.completedAt;
        if (data.durationSeconds !== undefined) {
            update.duration_seconds = data.durationSeconds;
        }
        if (data.entityStats !== undefined) update.entity_stats = data.entityStats;
        if (data.importJobIds !== undefined) {
            update.import_job_ids = data.importJobIds;
        }
        if (data.errorMessage !== undefined) {
            update.error_message = data.errorMessage;
        }
        if (data.errorType !== undefined) update.error_type = data.errorType;
        if (data.errorDetails !== undefined) {
            update.error_details = data.errorDetails;
        }
        if (data.performanceMetrics !== undefined) {
            update.performance_metrics = data.performanceMetrics;
        }

        return ConnectorSyncExecution.findByIdAndUpdate(executionId, update, {
            new: true,
        });
    }

    static async findByConnectorId(
        connectorId: number,
        limit = 50
    ): Promise<IConnectorSyncExecution[]> {
        await ensureMongoConnection();
        return ConnectorSyncExecution.findByConnectorId(connectorId, limit);
    }

    static async findLatestRunning(
        connectorId: number
    ): Promise<IConnectorSyncExecution | null> {
        await ensureMongoConnection();
        return ConnectorSyncExecution.findLatestRunning(connectorId);
    }

    static async findStaleRunning(
        connectorId: number,
        olderThan: Date
    ): Promise<IConnectorSyncExecution[]> {
        await ensureMongoConnection();
        return ConnectorSyncExecution.findStaleRunning(connectorId, olderThan);
    }

    static async getLastCompletedAt(
        connectorId: number
    ): Promise<Date | null> {
        await ensureMongoConnection();
        const doc = await ConnectorSyncExecution.findOne({
            connector_id: connectorId,
            status: { $in: ["SUCCESS", "FAILED", "PARTIAL", "TIMEOUT"] },
        })
            .sort({ completed_at: -1 })
            .select({ completed_at: 1 });
        return doc?.completed_at ?? null;
    }

    static async getLastScheduledIncrementalSuccessAt(
        connectorId: number
    ): Promise<Date | null> {
        await ensureMongoConnection();
        const doc = await ConnectorSyncExecution.findOne({
            connector_id: connectorId,
            trigger: "scheduled",
            sync_mode: "INCREMENTAL",
            status: "SUCCESS",
        })
            .sort({ completed_at: -1 })
            .select({ completed_at: 1 });
        return doc?.completed_at ?? null;
    }

    static async hasScheduledIncrementalSuccess(
        connectorId: number
    ): Promise<boolean> {
        await ensureMongoConnection();
        const doc = await ConnectorSyncExecution.findOne({
            connector_id: connectorId,
            trigger: "scheduled",
            sync_mode: "INCREMENTAL",
            status: "SUCCESS",
        })
            .select({ _id: 1 })
            .lean();
        return Boolean(doc);
    }

    static hashMapping(mapping: unknown): string {
        return createHash("md5").update(JSON.stringify(mapping)).digest("hex");
    }
}
