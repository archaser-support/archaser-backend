import type { Types } from "mongoose";

import { ConnectorSyncExecutionModel } from "./model";
import { ensureMongoConnection } from "./mongooseConnection";
import { durationSecondsFrom } from "./store";
import { ACCOUNT_RUNNING_UNIQUE_INDEX_NAME } from "./syncAlreadyRunningError";

/** Explicit reason written on older twin RUNNING rows during deploy cleanup. */
export const TWIN_RUNNING_CLEANUP_ERROR_MESSAGE =
    "Superseded by a newer RUNNING sync (deploy cleanup of duplicate RUNNING rows)";

export const TWIN_RUNNING_CLEANUP_ERROR_TYPE = "timeout";

export type CleanupTwinRunningResult = {
    accountsWithTwins: number;
    twinDocsTimedOut: number;
    /** Newest RUNNING kept per cleaned account (execution_id). */
    keptExecutionIds: string[];
};

export type EnsureUniqueRunningMutexResult = {
    cleanup: CleanupTwinRunningResult;
    /** False when dry-run skipped index create, or create was not requested. */
    indexEnsured: boolean;
};

type TwinRunningDoc = {
    _id: Types.ObjectId;
    execution_id: string;
    account_id: number;
    started_at: Date;
};

type TwinRunningGroup = {
    _id: number;
    docs: TwinRunningDoc[];
    count: number;
};

/**
 * For each account with multiple RUNNING sync-history docs, keep the newest
 * (started_at desc, then _id desc) and mark older twins TIMEOUT.
 * Idempotent: no-op when no twins remain.
 */
export async function cleanupTwinRunningSyncExecutions(options?: {
    dryRun?: boolean;
    completedAt?: Date;
}): Promise<CleanupTwinRunningResult> {
    await ensureMongoConnection();
    const dryRun = options?.dryRun === true;
    const completedAt = options?.completedAt ?? new Date();

    const groups = (await ConnectorSyncExecutionModel.aggregate([
        { $match: { status: "RUNNING" } },
        { $sort: { started_at: -1, _id: -1 } },
        {
            $group: {
                _id: "$account_id",
                docs: {
                    $push: {
                        _id: "$_id",
                        execution_id: "$execution_id",
                        account_id: "$account_id",
                        started_at: "$started_at",
                    },
                },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 1 } } },
    ])) as TwinRunningGroup[];

    const keptExecutionIds: string[] = [];
    let twinDocsTimedOut = 0;

    for (const group of groups) {
        const [newest, ...older] = group.docs;
        if (!newest || older.length === 0) {
            continue;
        }
        keptExecutionIds.push(newest.execution_id);

        if (dryRun) {
            twinDocsTimedOut += older.length;
            continue;
        }

        for (const twin of older) {
            const result = await ConnectorSyncExecutionModel.updateOne(
                { _id: twin._id, status: "RUNNING" },
                {
                    $set: {
                        status: "TIMEOUT",
                        completed_at: completedAt,
                        duration_seconds: durationSecondsFrom(
                            twin.started_at,
                            completedAt
                        ),
                        error_message: TWIN_RUNNING_CLEANUP_ERROR_MESSAGE,
                        error_type: TWIN_RUNNING_CLEANUP_ERROR_TYPE,
                        awaiting_post_ingest_drain: false,
                        pending_terminal_status: null,
                        pending_error_message: null,
                        pending_error_type: null,
                    },
                }
            );
            if (result.modifiedCount > 0) {
                twinDocsTimedOut += 1;
            }
        }
    }

    return {
        accountsWithTwins: groups.length,
        twinDocsTimedOut,
        keptExecutionIds,
    };
}

/**
 * Ensure the partial unique index (one RUNNING per account). Prefer createIndex
 * over Model.syncIndexes — lighter and avoids createCollection writes.
 * Idempotent when the index already exists with the same options.
 */
export async function ensureAccountRunningUniqueIndex(): Promise<void> {
    await ensureMongoConnection();
    const collection = ConnectorSyncExecutionModel.collection;
    const indexes = await collection.indexes();
    const existing = indexes.find(
        (idx) => idx.name === ACCOUNT_RUNNING_UNIQUE_INDEX_NAME
    );
    if (
        existing &&
        existing.unique === true &&
        existing.partialFilterExpression &&
        (existing.partialFilterExpression as { status?: string }).status ===
            "RUNNING"
    ) {
        return;
    }

    await collection.createIndex(
        { account_id: 1 },
        {
            unique: true,
            name: ACCOUNT_RUNNING_UNIQUE_INDEX_NAME,
            partialFilterExpression: { status: "RUNNING" },
        }
    );
}

/**
 * Deploy-safe path: cleanup twin RUNNING rows, then ensure the unique index.
 * Pass dryRun to report twins without mutating or creating the index.
 */
export async function ensureUniqueRunningSyncMutex(options?: {
    dryRun?: boolean;
    skipIndex?: boolean;
    completedAt?: Date;
}): Promise<EnsureUniqueRunningMutexResult> {
    const dryRun = options?.dryRun === true;
    const cleanup = await cleanupTwinRunningSyncExecutions({
        dryRun,
        completedAt: options?.completedAt,
    });

    if (dryRun || options?.skipIndex === true) {
        return { cleanup, indexEnsured: false };
    }

    await ensureAccountRunningUniqueIndex();
    return { cleanup, indexEnsured: true };
}

let mutexEnsured = false;

/**
 * One-shot ensure for mongoose store first use (same pattern as import-cache
 * index ensure). Safe to call repeatedly; no-ops after the first success.
 */
export async function ensureUniqueRunningSyncMutexOnce(): Promise<void> {
    if (mutexEnsured) {
        return;
    }
    await ensureUniqueRunningSyncMutex();
    mutexEnsured = true;
}

/** Test helper — allow re-running ensure after model/index changes. */
export function resetUniqueRunningSyncMutexEnsuredForTests(): void {
    mutexEnsured = false;
}
