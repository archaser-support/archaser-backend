"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectorSyncExecutionService = void 0;
const crypto_1 = require("crypto");
const mongoose_1 = require("@/lib/mongoose");
const ConnectorSyncExecution_1 = __importDefault(require("@/models/ConnectorSyncExecution"));
class ConnectorSyncExecutionService {
    static async createExecution(data) {
        await (0, mongoose_1.ensureMongoConnection)();
        const execution = new ConnectorSyncExecution_1.default({
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
    static async updateExecution(executionId, data) {
        await (0, mongoose_1.ensureMongoConnection)();
        const update = { modified_at: new Date() };
        if (data.status !== undefined)
            update.status = data.status;
        if (data.completedAt !== undefined)
            update.completed_at = data.completedAt;
        if (data.durationSeconds !== undefined) {
            update.duration_seconds = data.durationSeconds;
        }
        if (data.entityStats !== undefined)
            update.entity_stats = data.entityStats;
        if (data.importJobIds !== undefined) {
            update.import_job_ids = data.importJobIds;
        }
        if (data.errorMessage !== undefined) {
            update.error_message = data.errorMessage;
        }
        if (data.errorType !== undefined)
            update.error_type = data.errorType;
        if (data.errorDetails !== undefined) {
            update.error_details = data.errorDetails;
        }
        if (data.performanceMetrics !== undefined) {
            update.performance_metrics = data.performanceMetrics;
        }
        return ConnectorSyncExecution_1.default.findByIdAndUpdate(executionId, update, {
            new: true,
        });
    }
    static async findByConnectorId(connectorId, limit = 50) {
        await (0, mongoose_1.ensureMongoConnection)();
        return ConnectorSyncExecution_1.default.findByConnectorId(connectorId, limit);
    }
    static async findLatestRunning(connectorId) {
        await (0, mongoose_1.ensureMongoConnection)();
        return ConnectorSyncExecution_1.default.findLatestRunning(connectorId);
    }
    static async findStaleRunning(connectorId, olderThan) {
        await (0, mongoose_1.ensureMongoConnection)();
        return ConnectorSyncExecution_1.default.findStaleRunning(connectorId, olderThan);
    }
    static async getLastCompletedAt(connectorId) {
        await (0, mongoose_1.ensureMongoConnection)();
        const doc = await ConnectorSyncExecution_1.default.findOne({
            connector_id: connectorId,
            status: { $in: ["SUCCESS", "FAILED", "PARTIAL", "TIMEOUT"] },
        })
            .sort({ completed_at: -1 })
            .select({ completed_at: 1 });
        return doc?.completed_at ?? null;
    }
    static async getLastScheduledIncrementalSuccessAt(connectorId) {
        await (0, mongoose_1.ensureMongoConnection)();
        const doc = await ConnectorSyncExecution_1.default.findOne({
            connector_id: connectorId,
            trigger: "scheduled",
            sync_mode: "INCREMENTAL",
            status: "SUCCESS",
        })
            .sort({ completed_at: -1 })
            .select({ completed_at: 1 });
        return doc?.completed_at ?? null;
    }
    static async hasScheduledIncrementalSuccess(connectorId) {
        await (0, mongoose_1.ensureMongoConnection)();
        const doc = await ConnectorSyncExecution_1.default.findOne({
            connector_id: connectorId,
            trigger: "scheduled",
            sync_mode: "INCREMENTAL",
            status: "SUCCESS",
        })
            .select({ _id: 1 })
            .lean();
        return Boolean(doc);
    }
    static hashMapping(mapping) {
        return (0, crypto_1.createHash)("md5").update(JSON.stringify(mapping)).digest("hex");
    }
}
exports.ConnectorSyncExecutionService = ConnectorSyncExecutionService;
