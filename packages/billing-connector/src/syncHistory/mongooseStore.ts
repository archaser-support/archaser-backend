import { ConnectorSyncExecutionModel } from "./model";
import { ensureMongoConnection } from "./mongooseConnection";
import {
    defaultSinceDate,
    durationSecondsFrom,
    STALE_RUNNING_HOURS,
    type SyncHistoryStore,
} from "./store";
import type {
    CompleteExecutionInput,
    CreateRunningExecutionInput,
    ListExecutionsOptions,
    MarkExecutionCancelledInput,
    SweepStaleRunningOptions,
    SyncHistoryExecution,
} from "./types";

function toExecution(doc: {
    execution_id: string;
    connector_id: number;
    account_id: number;
    provider: string;
    trigger: SyncHistoryExecution["trigger"];
    sync_mode: string;
    status: SyncHistoryExecution["status"];
    started_at: Date;
    completed_at?: Date | null;
    duration_seconds?: number | null;
    entity_stats?: SyncHistoryExecution["entity_stats"] | null;
    error_message?: string | null;
    error_type?: string | null;
}): SyncHistoryExecution {
    return {
        execution_id: doc.execution_id,
        connector_id: doc.connector_id,
        account_id: doc.account_id,
        provider: doc.provider,
        trigger: doc.trigger,
        sync_mode: doc.sync_mode,
        status: doc.status,
        started_at: doc.started_at,
        completed_at: doc.completed_at ?? null,
        duration_seconds: doc.duration_seconds ?? null,
        entity_stats: (doc.entity_stats ?? {}) as SyncHistoryExecution["entity_stats"],
        error_message: doc.error_message ?? null,
        error_type: doc.error_type ?? null,
    };
}

export const mongooseSyncHistoryStore: SyncHistoryStore = {
    async createRunning(
        input: CreateRunningExecutionInput
    ): Promise<SyncHistoryExecution> {
        await ensureMongoConnection();
        const created = await ConnectorSyncExecutionModel.create({
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
        });
        return toExecution(created);
    },

    async completeIfRunning(
        executionId: string,
        input: CompleteExecutionInput
    ): Promise<SyncHistoryExecution | null> {
        await ensureMongoConnection();
        const completedAt = input.completedAt ?? new Date();
        const existing = await ConnectorSyncExecutionModel.findOne({
            execution_id: executionId,
            status: "RUNNING",
        }).lean();
        if (!existing) {
            return null;
        }

        const update: Record<string, unknown> = {
            status: input.status,
            completed_at: completedAt,
            duration_seconds: durationSecondsFrom(
                existing.started_at,
                completedAt
            ),
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

        const updated = await ConnectorSyncExecutionModel.findOneAndUpdate(
            { execution_id: executionId, status: "RUNNING" },
            { $set: update },
            { returnDocument: "after" }
        ).lean();
        return updated ? toExecution(updated) : null;
    },

    async markCancelledIfRunning(
        executionId: string,
        input?: MarkExecutionCancelledInput
    ): Promise<SyncHistoryExecution | null> {
        await ensureMongoConnection();
        const completedAt = input?.completedAt ?? new Date();
        const existing = await ConnectorSyncExecutionModel.findOne({
            execution_id: executionId,
            status: "RUNNING",
        }).lean();
        if (!existing) {
            return null;
        }

        const updated = await ConnectorSyncExecutionModel.findOneAndUpdate(
            { execution_id: executionId, status: "RUNNING" },
            {
                $set: {
                    status: "TIMEOUT",
                    completed_at: completedAt,
                    duration_seconds: durationSecondsFrom(
                        existing.started_at,
                        completedAt
                    ),
                    error_message:
                        input?.errorMessage ?? "Sync stopped by operator",
                    error_type: "cancelled",
                },
            },
            { returnDocument: "after" }
        ).lean();
        return updated ? toExecution(updated) : null;
    },

    async listForAccount(
        accountId: number,
        options?: ListExecutionsOptions
    ): Promise<SyncHistoryExecution[]> {
        await ensureMongoConnection();
        const since = options?.since ?? defaultSinceDate();
        const limit = options?.limit ?? 500;
        const docs = await ConnectorSyncExecutionModel.find({
            account_id: accountId,
            started_at: { $gte: since },
        })
            .sort({ started_at: -1 })
            .limit(limit)
            .lean();
        return docs.map(toExecution);
    },

    async sweepStaleRunning(
        options?: SweepStaleRunningOptions
    ): Promise<number> {
        await ensureMongoConnection();
        const hours = options?.olderThanHours ?? STALE_RUNNING_HOURS;
        const completedAt = options?.completedAt ?? new Date();
        const olderThan = new Date(
            completedAt.getTime() - hours * 60 * 60 * 1000
        );
        const filter: Record<string, unknown> = {
            status: "RUNNING",
            started_at: { $lt: olderThan },
        };
        if (options?.accountId !== undefined) {
            filter.account_id = options.accountId;
        }

        const stale = await ConnectorSyncExecutionModel.find(filter).lean();
        if (stale.length === 0) {
            return 0;
        }

        let updated = 0;
        for (const doc of stale) {
            const result = await ConnectorSyncExecutionModel.updateOne(
                { _id: doc._id, status: "RUNNING" },
                {
                    $set: {
                        status: "TIMEOUT",
                        completed_at: completedAt,
                        duration_seconds: durationSecondsFrom(
                            doc.started_at,
                            completedAt
                        ),
                        error_message:
                            "Sync execution timed out (stale RUNNING sweeper)",
                        error_type: "timeout",
                    },
                }
            );
            if (result.modifiedCount > 0) {
                updated += 1;
            }
        }
        return updated;
    },
};
