"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemorySyncHistoryStore = createMemorySyncHistoryStore;
const store_1 = require("./store");
function clone(doc) {
    return {
        ...doc,
        started_at: new Date(doc.started_at),
        completed_at: doc.completed_at ? new Date(doc.completed_at) : null,
        entity_stats: { ...doc.entity_stats },
    };
}
/** In-memory store for unit tests (no Mongo required). */
function createMemorySyncHistoryStore() {
    const byId = new Map();
    return {
        reset() {
            byId.clear();
        },
        all() {
            return [...byId.values()].map(clone);
        },
        async createRunning(input) {
            if (byId.has(input.executionId)) {
                throw new Error(`execution_id already exists: ${input.executionId}`);
            }
            const doc = {
                execution_id: input.executionId,
                connector_id: input.connectorId,
                account_id: input.accountId,
                provider: input.provider,
                trigger: input.trigger,
                sync_mode: input.syncMode,
                status: "RUNNING",
                started_at: input.startedAt ?? new Date(),
                completed_at: null,
                duration_seconds: null,
                entity_stats: {},
                error_message: null,
                error_type: null,
            };
            byId.set(doc.execution_id, doc);
            return clone(doc);
        },
        async completeIfRunning(executionId, input) {
            const existing = byId.get(executionId);
            if (!existing || existing.status !== "RUNNING") {
                return null;
            }
            const completedAt = input.completedAt ?? new Date();
            existing.status = input.status;
            existing.completed_at = completedAt;
            existing.duration_seconds = (0, store_1.durationSecondsFrom)(existing.started_at, completedAt);
            if (input.entityStats !== undefined) {
                existing.entity_stats = { ...input.entityStats };
            }
            if (input.errorMessage !== undefined) {
                existing.error_message = input.errorMessage;
            }
            if (input.errorType !== undefined) {
                existing.error_type = input.errorType;
            }
            return clone(existing);
        },
        async markCancelledIfRunning(executionId, input) {
            const existing = byId.get(executionId);
            if (!existing || existing.status !== "RUNNING") {
                return null;
            }
            const completedAt = input?.completedAt ?? new Date();
            existing.status = "TIMEOUT";
            existing.completed_at = completedAt;
            existing.duration_seconds = (0, store_1.durationSecondsFrom)(existing.started_at, completedAt);
            existing.error_message =
                input?.errorMessage ?? "Sync stopped by operator";
            existing.error_type = "cancelled";
            return clone(existing);
        },
        async listForAccount(accountId, options) {
            const since = options?.since ?? (0, store_1.defaultSinceDate)();
            const limit = options?.limit ?? 500;
            return [...byId.values()]
                .filter((doc) => doc.account_id === accountId &&
                doc.started_at.getTime() >= since.getTime())
                .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
                .slice(0, limit)
                .map(clone);
        },
        async sweepStaleRunning(options) {
            const hours = options?.olderThanHours ?? store_1.STALE_RUNNING_HOURS;
            const completedAt = options?.completedAt ?? new Date();
            const olderThan = new Date(completedAt.getTime() - hours * 60 * 60 * 1000);
            let count = 0;
            for (const doc of byId.values()) {
                if (doc.status !== "RUNNING")
                    continue;
                if (options?.accountId !== undefined &&
                    doc.account_id !== options.accountId) {
                    continue;
                }
                if (doc.started_at.getTime() >= olderThan.getTime())
                    continue;
                doc.status = "TIMEOUT";
                doc.completed_at = completedAt;
                doc.duration_seconds = (0, store_1.durationSecondsFrom)(doc.started_at, completedAt);
                doc.error_message =
                    "Sync execution timed out (stale RUNNING sweeper)";
                doc.error_type = "timeout";
                count += 1;
            }
            return count;
        },
    };
}
