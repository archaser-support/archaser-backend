"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mongooseSyncHistoryStore = void 0;
const model_1 = require("./model");
const mongooseConnection_1 = require("./mongooseConnection");
const store_1 = require("./store");
function toExecution(doc) {
    return {
        execution_id: doc.execution_id,
        connector_id: doc.connector_id,
        account_id: doc.account_id,
        provider: doc.provider,
        trigger: doc.trigger,
        sync_mode: doc.sync_mode,
        status: doc.status,
        started_at: doc.started_at,
        last_progress_at: doc.last_progress_at ?? doc.started_at,
        completed_at: doc.completed_at ?? null,
        duration_seconds: doc.duration_seconds ?? null,
        entity_stats: (doc.entity_stats ?? {}),
        error_message: doc.error_message ?? null,
        error_type: doc.error_type ?? null,
        awaiting_post_ingest_drain: doc.awaiting_post_ingest_drain === true,
        pending_terminal_status: doc.pending_terminal_status ?? null,
        pending_error_message: doc.pending_error_message ?? null,
        pending_error_type: doc.pending_error_type ?? null,
    };
}
function progressIdleBefore(completedAt, idleHours) {
    return new Date(completedAt.getTime() - idleHours * 60 * 60 * 1000);
}
exports.mongooseSyncHistoryStore = {
    async createRunning(input) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const startedAt = input.startedAt ?? new Date();
        const created = await model_1.ConnectorSyncExecutionModel.create({
            execution_id: input.executionId,
            connector_id: input.connectorId,
            account_id: input.accountId,
            provider: input.provider,
            trigger: input.trigger,
            sync_mode: input.syncMode,
            status: "RUNNING",
            started_at: startedAt,
            last_progress_at: startedAt,
            completed_at: null,
            duration_seconds: null,
            entity_stats: {},
            error_message: null,
            error_type: null,
            awaiting_post_ingest_drain: false,
            pending_terminal_status: null,
            pending_error_message: null,
            pending_error_type: null,
        });
        return toExecution(created);
    },
    async completeIfRunning(executionId, input) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const completedAt = input.completedAt ?? new Date();
        const existing = await model_1.ConnectorSyncExecutionModel.findOne({
            execution_id: executionId,
            status: "RUNNING",
        }).lean();
        if (!existing) {
            return null;
        }
        const update = {
            status: input.status,
            completed_at: completedAt,
            duration_seconds: (0, store_1.durationSecondsFrom)(existing.started_at, completedAt),
            awaiting_post_ingest_drain: false,
            pending_terminal_status: null,
            pending_error_message: null,
            pending_error_type: null,
        };
        if (input.entityStats !== undefined) {
            update.entity_stats = input.entityStats;
        }
        if (input.errorMessage !== undefined) {
            update.error_message = input.errorMessage;
        }
        if (input.errorType !== undefined) {
            update.error_type = input.errorType;
        }
        const updated = await model_1.ConnectorSyncExecutionModel.findOneAndUpdate({ execution_id: executionId, status: "RUNNING" }, { $set: update }, { returnDocument: "after" }).lean();
        return updated ? toExecution(updated) : null;
    },
    async markCancelledIfRunning(executionId, input) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const completedAt = input?.completedAt ?? new Date();
        const existing = await model_1.ConnectorSyncExecutionModel.findOne({
            execution_id: executionId,
            status: "RUNNING",
        }).lean();
        if (!existing) {
            return null;
        }
        const updated = await model_1.ConnectorSyncExecutionModel.findOneAndUpdate({ execution_id: executionId, status: "RUNNING" }, {
            $set: {
                status: "TIMEOUT",
                completed_at: completedAt,
                duration_seconds: (0, store_1.durationSecondsFrom)(existing.started_at, completedAt),
                error_message: input?.errorMessage ?? "Sync stopped by operator",
                error_type: "cancelled",
                awaiting_post_ingest_drain: false,
                pending_terminal_status: null,
                pending_error_message: null,
                pending_error_type: null,
            },
        }, { returnDocument: "after" }).lean();
        return updated ? toExecution(updated) : null;
    },
    async touchProgressIfRunning(executionId, input) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const progressAt = input?.progressAt ?? new Date();
        const update = {
            last_progress_at: progressAt,
        };
        if (input?.entityStats !== undefined) {
            update.entity_stats = input.entityStats;
        }
        const updated = await model_1.ConnectorSyncExecutionModel.findOneAndUpdate({ execution_id: executionId, status: "RUNNING" }, { $set: update }, { returnDocument: "after" }).lean();
        return updated ? toExecution(updated) : null;
    },
    async deferCompletionUntilPostIngestDrain(executionId, input) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const progressAt = input.progressAt ?? new Date();
        const update = {
            awaiting_post_ingest_drain: true,
            pending_terminal_status: input.pendingStatus,
            pending_error_message: input.errorMessage ?? null,
            pending_error_type: input.errorType ?? null,
            last_progress_at: progressAt,
        };
        if (input.entityStats !== undefined) {
            update.entity_stats = input.entityStats;
        }
        const updated = await model_1.ConnectorSyncExecutionModel.findOneAndUpdate({ execution_id: executionId, status: "RUNNING" }, { $set: update }, { returnDocument: "after" }).lean();
        return updated ? toExecution(updated) : null;
    },
    async listAwaitingPostIngestDrainExecutions(accountId) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const filter = {
            status: "RUNNING",
            awaiting_post_ingest_drain: true,
        };
        if (accountId !== undefined) {
            filter.account_id = accountId;
        }
        const docs = await model_1.ConnectorSyncExecutionModel.find(filter)
            .sort({ started_at: -1 })
            .lean();
        return docs.map(toExecution);
    },
    async listForAccount(accountId, options) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const since = options?.since ?? (0, store_1.defaultSinceDate)();
        const limit = options?.limit ?? 500;
        const docs = await model_1.ConnectorSyncExecutionModel.find({
            account_id: accountId,
            started_at: { $gte: since },
        })
            .sort({ started_at: -1 })
            .limit(limit)
            .lean();
        return docs.map(toExecution);
    },
    async listRunningAccountIds() {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const accountIds = await model_1.ConnectorSyncExecutionModel.distinct("account_id", { status: "RUNNING" });
        return accountIds
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id));
    },
    async sweepStaleRunning(options) {
        await (0, mongooseConnection_1.ensureMongoConnection)();
        const hours = options?.olderThanHours ?? store_1.STALE_RUNNING_HOURS;
        const completedAt = options?.completedAt ?? new Date();
        const idleBefore = progressIdleBefore(completedAt, hours);
        const filter = {
            status: "RUNNING",
            $or: [
                { last_progress_at: { $lt: idleBefore } },
                {
                    last_progress_at: { $exists: false },
                    started_at: { $lt: idleBefore },
                },
            ],
        };
        if (options?.accountId !== undefined) {
            filter.account_id = options.accountId;
        }
        const stale = await model_1.ConnectorSyncExecutionModel.find(filter).lean();
        if (stale.length === 0) {
            return 0;
        }
        let updated = 0;
        for (const doc of stale) {
            const result = await model_1.ConnectorSyncExecutionModel.updateOne({ _id: doc._id, status: "RUNNING" }, {
                $set: {
                    status: "TIMEOUT",
                    completed_at: completedAt,
                    duration_seconds: (0, store_1.durationSecondsFrom)(doc.started_at, completedAt),
                    error_message: "Sync execution timed out (stale RUNNING sweeper)",
                    error_type: "timeout",
                    awaiting_post_ingest_drain: false,
                    pending_terminal_status: null,
                    pending_error_message: null,
                    pending_error_type: null,
                },
            });
            if (result.modifiedCount > 0) {
                updated += 1;
            }
        }
        return updated;
    },
};
