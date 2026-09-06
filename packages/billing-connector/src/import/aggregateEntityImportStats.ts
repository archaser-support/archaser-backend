import type { ConnectorSyncCounts } from "../sync/connectorSyncRuntime";
import type { EntityImportBatchResult } from "./entityImporter";

export const SAMPLE_ERRORS_CAP = 3;

export interface EntityImportStatsAccum {
    failed: number;
    skipped: number;
    mandatoryFieldSkips: number;
    sample_errors: string[];
}

export type EntityImportStatKey =
    | "Customer"
    | "Contact"
    | "Invoice"
    | "Payment";

export function emptyEntityImportStatsAccum(): EntityImportStatsAccum {
    return {
        failed: 0,
        skipped: 0,
        mandatoryFieldSkips: 0,
        sample_errors: [],
    };
}

export function appendEntityImportIssue(
    accum: EntityImportStatsAccum,
    message: string
): void {
    if (!message.trim()) {
        return;
    }
    if (accum.sample_errors.includes(message)) {
        return;
    }
    if (accum.sample_errors.length >= SAMPLE_ERRORS_CAP) {
        return;
    }
    accum.sample_errors.push(message);
}

export function appendBatchImportIssue(
    batch: EntityImportBatchResult,
    message: string
): void {
    if (!batch.issueMessages) {
        batch.issueMessages = [];
    }
    if (batch.issueMessages.includes(message)) {
        return;
    }
    if (batch.issueMessages.length >= SAMPLE_ERRORS_CAP) {
        return;
    }
    batch.issueMessages.push(message);
}

export function accumulateBatchIntoEntityStats(
    entityStats: Partial<Record<EntityImportStatKey, EntityImportStatsAccum>>,
    entityType: EntityImportStatKey,
    batch: Pick<
        EntityImportBatchResult,
        "failed" | "skipped" | "mandatoryFieldSkips" | "issueMessages"
    >
): void {
    const accum =
        entityStats[entityType] ?? emptyEntityImportStatsAccum();
    accum.failed += batch.failed;
    accum.skipped += batch.skipped;
    accum.mandatoryFieldSkips += batch.mandatoryFieldSkips ?? 0;
    for (const message of batch.issueMessages ?? []) {
        appendEntityImportIssue(accum, message);
    }
    entityStats[entityType] = accum;
}

export function totalMandatoryFieldSkipsFromEntityStats(
    entityStats: Partial<Record<string, EntityImportStatsAccum>> | undefined
): number {
    if (!entityStats) {
        return 0;
    }
    let total = 0;
    for (const accum of Object.values(entityStats)) {
        if (!accum) {
            continue;
        }
        total += accum.mandatoryFieldSkips;
    }
    return total;
}

export function applyEntityImportResultToSyncStats(
    stats: ConnectorSyncCounts,
    entityType: EntityImportStatKey,
    batch: EntityImportBatchResult
): void {
    if (!stats.entityImportStats) {
        stats.entityImportStats = {};
    }
    accumulateBatchIntoEntityStats(stats.entityImportStats, entityType, batch);
    stats.mandatoryFieldSkips =
        (stats.mandatoryFieldSkips ?? 0) + (batch.mandatoryFieldSkips ?? 0);
}
