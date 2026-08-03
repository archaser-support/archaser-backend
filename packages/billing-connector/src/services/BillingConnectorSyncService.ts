import type {
    BillingConnector,
    ConnectorSyncMode,
    ImportType,
} from "@prisma/client";
import { ImportStatus } from "@prisma/client";

import * as metrics from "@/lib/metrics";
import { prisma } from "@/lib/prisma";
import {
    CONNECTOR_RETRY_BACKOFF_MS,
    classifyConnectorError,
    sleepMs,
} from "@/server/integrations/billing/connectorErrorClassification";
import {
    extractMaxUpdatedAt,
    importMappedEntityBatch,
} from "@/server/integrations/billing/connectorEntityImporter";
import { sweepStaleSyncExecutions } from "@/server/integrations/billing/staleSyncExecutionSweeper";
import { PriorityProviderClient } from "@/server/integrations/priority/PriorityProviderClient";
import { isPriorityEntityImportType } from "@/server/integrations/priority/priorityApiContract";
import type { PriorityEntityImportType } from "@/server/integrations/priority/fixtures/samplePayloads";
import { ConnectorFieldMappingService } from "@/server/services/ConnectorFieldMappingService";
import type { EntitySyncStats } from "@/models/ConnectorSyncExecution";
import { ConnectorSyncExecutionService } from "@/server/services/ConnectorSyncExecutionService";
import { ImportJobService } from "@/server/services/ImportJobService";
import { updateAccountLastSyncDate } from "@/server/services/import/updateAccountLastSyncDate";
import { triggerPostImportOverdueMetrics } from "@/server/services/creditInsurance/postImportOverdueMetrics";
import {
    replayArImportForCustomers,
    applyMaturedDeferredPayments,
} from "@/server/services/import/importArReplayService";
import { MongoLogService } from "@/server/services/MongoLogService";
import { decryptCredentials } from "@/server/utils/billingConnectorCrypto";
import {
    mapErpRecord,
    parseMappingRules,
    validateMappedRow,
} from "@/server/utils/connectorFieldUtils";
import { LogLevel } from "@/types/enums";

/**
 * Entity ingest order per PRD (D6): Customer → Payment → Invoice → Contact.
 * Replay and maturity run as orchestration steps after Invoice (not ERP entity
 * types), before Contact, so AR math is settled before non-AR entities.
 */
const ENTITY_ORDER: PriorityEntityImportType[] = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];

const mongoLog = new MongoLogService();
const ANTI_SPAM_MS = 2 * 60 * 1000;

export type ConnectorRunMode = "preview" | "backfill" | "incremental";
export type ConnectorRunTrigger = "scheduled" | "manual" | "preview" | "backfill";

export interface ConnectorSyncRunResult {
    execution_id: string;
    status: string;
    sync_mode: ConnectorSyncMode;
    trigger: ConnectorRunTrigger;
    entity_stats: Record<string, EntitySyncStats>;
    duration_seconds: number;
}

export class BillingConnectorSyncService {
    private static instance: BillingConnectorSyncService;

    public static getInstance(): BillingConnectorSyncService {
        if (!BillingConnectorSyncService.instance) {
            BillingConnectorSyncService.instance =
                new BillingConnectorSyncService();
        }
        return BillingConnectorSyncService.instance;
    }

    async runSync(options: {
        accountId: number;
        mode: ConnectorRunMode;
        trigger: ConnectorRunTrigger;
        correlationId?: string;
        userId?: string;
        skipAntiSpam?: boolean;
    }): Promise<ConnectorSyncRunResult> {
        const startedAt = Date.now();
        const mappingService = ConnectorFieldMappingService.getInstance();

        if (options.mode !== "preview") {
            await mappingService.assertMappingsCompleteForEnabledEntities(
                options.accountId
            );
        }

        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: options.accountId },
            include: {
                ConnectorFieldMapping: true,
                ConnectorSyncState: true,
            },
        });

        if (!connector?.base_url || !connector.credentials_encrypted) {
            throw Object.assign(new Error("Billing connector is not configured"), {
                statusCode: 400,
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }

        if (connector.status === "Error" && options.mode !== "preview") {
            throw Object.assign(
                new Error("Connector is in error state — fix credentials first"),
                { statusCode: 409, code: "CONNECTOR_IN_ERROR" }
            );
        }

        if (
            options.mode === "incremental" &&
            connector.sync_mode !== "INCREMENTAL"
        ) {
            throw Object.assign(new Error("Backfill is not complete yet"), {
                statusCode: 409,
                code: "BACKFILL_NOT_COMPLETE",
            });
        }

        await sweepStaleSyncExecutions(
            connector.id,
            connector.account_id,
            connector.provider,
            connector.backfill_max_duration_seconds
        );

        const running =
            await ConnectorSyncExecutionService.findLatestRunning(connector.id);
        if (running) {
            throw Object.assign(new Error("A sync is already running"), {
                statusCode: 409,
                code: "SYNC_ALREADY_RUNNING",
            });
        }

        if (!options.skipAntiSpam && options.mode !== "preview") {
            const lastCompleted =
                await ConnectorSyncExecutionService.getLastCompletedAt(
                    connector.id
                );
            if (
                lastCompleted &&
                Date.now() - lastCompleted.getTime() < ANTI_SPAM_MS
            ) {
                throw Object.assign(
                    new Error("Please wait before starting another sync"),
                    { statusCode: 429, code: "TOO_MANY_REQUESTS" }
                );
            }
        }

        const enabledEntities = this.getEnabledEntities(connector);
        const effectiveSyncMode =
            options.mode === "incremental"
                ? "INCREMENTAL"
                : options.mode === "backfill"
                  ? "BACKFILL"
                  : connector.sync_mode;

        const mappingSnapshotHash = Object.fromEntries(
            connector.ConnectorFieldMapping.map((row) => [
                row.import_type,
                ConnectorSyncExecutionService.hashMapping(row.mapping),
            ])
        );

        const execution = await ConnectorSyncExecutionService.createExecution({
            connectorId: connector.id,
            accountId: connector.account_id,
            provider: connector.provider,
            trigger: options.trigger,
            syncMode: effectiveSyncMode,
            correlationId: options.correlationId,
            mappingSnapshotHash,
        });

        const entityStats: Record<string, EntitySyncStats> = {};
        const importJobIds: Record<string, string> = {};
        let runStatus: "SUCCESS" | "FAILED" | "PARTIAL" = "SUCCESS";
        let topError: string | undefined;
        let topErrorType: string | undefined;
        let pagesFetched = 0;

        // Accumulate affected customer IDs from Payment and Invoice ingests for
        // the replay and maturity orchestration steps that follow Invoice (D6).
        const arAffectedCustomerIds = new Set<number>();

        const provider = new PriorityProviderClient({
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials: decryptCredentials(connector.credentials_encrypted),
        });

        const mappingByType = new Map(
            connector.ConnectorFieldMapping.map((row) => [
                row.import_type,
                parseMappingRules(row.mapping),
            ])
        );

        const syncStateByEntity = new Map(
            connector.ConnectorSyncState.map((row) => [row.entity_type, row])
        );

        if (
            options.mode === "backfill" &&
            !connector.backfill_started_at
        ) {
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: { backfill_started_at: new Date() },
            });
        }

        try {
            for (const entityType of ENTITY_ORDER) {
                if (!enabledEntities.includes(entityType)) {
                    continue;
                }

                const syncState = syncStateByEntity.get(entityType);
                if (!syncState) {
                    throw new Error(
                        `Missing ConnectorSyncState for ${entityType}`
                    );
                }

                if (
                    effectiveSyncMode === "BACKFILL" &&
                    syncState.backfill_completed
                ) {
                    continue;
                }

                if (
                    effectiveSyncMode === "INCREMENTAL" &&
                    !syncState.backfill_completed
                ) {
                    continue;
                }

                entityStats[entityType] = {
                    pulled: 0,
                    success: 0,
                    failed: 0,
                    skipped: 0,
                };

                if (options.mode === "preview") {
                    continue;
                }

                const importJob = await ImportJobService.createImportJob(
                    {
                        account_id: connector.account_id,
                        user_id: options.userId,
                        import_type: entityType,
                        total_records: 0,
                        metadata: {
                            source: "billing_connector",
                            connector_id: connector.id,
                            sync_execution_id: execution._id.toString(),
                            trigger: options.trigger,
                        },
                    },
                    options.userId
                );
                importJobIds[entityType] = importJob.id;

                const entityResult = await this.syncEntity({
                    connector,
                    entityType,
                    syncStateId: syncState.id,
                    provider,
                    mappingRules: mappingByType.get(entityType) ?? [],
                    effectiveSyncMode,
                    importJobId: importJob.id,
                    userId: options.userId,
                    runStartedAt: startedAt,
                    onPageFetched: () => {
                        pagesFetched += 1;
                    },
                });

                entityStats[entityType] = entityResult.stats;

                await ImportJobService.updateImportJobStatus(
                    importJob.id,
                    entityResult.capped
                        ? ImportStatus.Processing
                        : ImportStatus.Completed,
                    {
                        processed_records: entityResult.stats.pulled,
                        successful_records: entityResult.stats.success,
                        failed_records: entityResult.stats.failed,
                    }
                );

                if (entityResult.capped) {
                    runStatus = "PARTIAL";
                }
                if (entityResult.hadFailure) {
                    runStatus = runStatus === "PARTIAL" ? "PARTIAL" : "FAILED";
                    topError = entityResult.errorMessage;
                    topErrorType = entityResult.errorType;
                }

                // Collect customer IDs from Payment and Invoice batches for AR replay.
                if (entityType === "Payment" || entityType === "Invoice") {
                    entityResult.affectedCustomerIds.forEach((id) =>
                        arAffectedCustomerIds.add(id)
                    );
                }

                // After Invoice ingest: run chronological replay, maturity pass,
                // and post-import credit-insurance metrics — before Contact (D6).
                if (entityType === "Invoice") {
                    const replayCustomerIds = Array.from(arAffectedCustomerIds);

                    if (replayCustomerIds.length > 0) {
                        const replaySummary = await replayArImportForCustomers(
                            replayCustomerIds,
                            connector.account_id
                        );
                        entityStats["_replay"] = {
                            pulled: replaySummary.eventsApplied,
                            success: replaySummary.paymentsLinked,
                            failed: 0,
                            skipped: replaySummary.deferredRemaining,
                        };
                    }

                    // Maturity always runs after Invoice — even with zero new rows —
                    // so calendar-date-eligible deferred payments are applied (D16/D17).
                    const startOfTodayUtc = new Date();
                    startOfTodayUtc.setUTCHours(0, 0, 0, 0);
                    const maturityResult = await applyMaturedDeferredPayments(
                        connector.account_id,
                        startOfTodayUtc
                    );
                    entityStats["_maturity"] = {
                        pulled: maturityResult.matured + maturityResult.deferredRemaining,
                        success: maturityResult.matured,
                        failed: 0,
                        skipped: maturityResult.deferredRemaining,
                    };

                    if (arAffectedCustomerIds.size > 0) {
                        await triggerPostImportOverdueMetrics(replayCustomerIds);
                    }
                }
            }

            const refreshedConnector = await prisma.billingConnector.findUnique({
                where: { id: connector.id },
                include: { ConnectorSyncState: true },
            });

            if (refreshedConnector) {
                const allBackfillDone = enabledEntities.every((entity) => {
                    const state = refreshedConnector.ConnectorSyncState.find(
                        (row) => row.entity_type === entity
                    );
                    return state?.backfill_completed === true;
                });

                if (
                    allBackfillDone &&
                    refreshedConnector.sync_mode === "BACKFILL"
                ) {
                    await prisma.billingConnector.update({
                        where: { id: connector.id },
                        data: { sync_mode: "INCREMENTAL" },
                    });
                }

                if (
                    options.trigger === "scheduled" &&
                    effectiveSyncMode === "INCREMENTAL" &&
                    runStatus === "SUCCESS"
                ) {
                    const allEntitiesSucceeded = enabledEntities.every(
                        (entity) => {
                            const stats = entityStats[entity];
                            return stats && stats.failed === 0;
                        }
                    );
                    if (allEntitiesSucceeded) {
                        await updateAccountLastSyncDate(connector.account_id);
                    }
                }
            }
        } catch (error) {
            runStatus = "FAILED";
            const classified = classifyConnectorError(error);
            topError = classified.message;
            topErrorType = classified.error_type;

            if (classified.incrementCircuitBreaker) {
                const updated = await prisma.billingConnector.update({
                    where: { id: connector.id },
                    data: {
                        consecutive_auth_failures: { increment: 1 },
                        last_connection_error: classified.message.slice(0, 500),
                    },
                });
                if (updated.consecutive_auth_failures >= 3) {
                    await prisma.billingConnector.update({
                        where: { id: connector.id },
                        data: {
                            status: "Error",
                            sync_enabled: false,
                        },
                    });
                }
            }

            await this.logSyncStep({
                accountId: connector.account_id,
                connectorId: connector.id,
                provider: connector.provider,
                syncMode: effectiveSyncMode,
                trigger: options.trigger,
                status: "FAILED",
                errorType: classified.error_type,
                correlationId: options.correlationId,
                syncExecutionId: execution._id.toString(),
                message: classified.message,
            });
        }

        const completedAt = new Date();
        const durationSeconds = Math.max(
            1,
            Math.round((completedAt.getTime() - startedAt) / 1000)
        );

        await ConnectorSyncExecutionService.updateExecution(
            execution._id.toString(),
            {
                status: runStatus,
                completedAt,
                durationSeconds,
                entityStats,
                importJobIds,
                errorMessage: topError,
                errorType: topErrorType,
                performanceMetrics: { pages_fetched: pagesFetched },
            }
        );

        metrics.billingConnectorSyncTotal.inc({
            provider: connector.provider,
            status: runStatus,
            sync_mode: effectiveSyncMode,
            trigger: options.trigger,
        });
        metrics.billingConnectorSyncDuration.observe(
            { provider: connector.provider, sync_mode: effectiveSyncMode },
            durationSeconds
        );
        if (topErrorType) {
            metrics.billingConnectorErrorsTotal.inc({
                provider: connector.provider,
                error_type: topErrorType,
                sync_mode: effectiveSyncMode,
            });
        }

        for (const [entityType, stats] of Object.entries(entityStats)) {
            for (const [result, count] of [
                ["success", stats.success],
                ["failed", stats.failed],
                ["skipped", stats.skipped],
            ] as const) {
                if (count > 0) {
                    metrics.billingConnectorRecordsProcessed.inc(
                        {
                            provider: connector.provider,
                            entity_type: entityType,
                            result,
                        },
                        count
                    );
                }
            }
        }

        return {
            execution_id: execution._id.toString(),
            status: runStatus,
            sync_mode: effectiveSyncMode,
            trigger: options.trigger,
            entity_stats: entityStats,
            duration_seconds: durationSeconds,
        };
    }

    private async syncEntity(params: {
        connector: BillingConnector;
        entityType: PriorityEntityImportType;
        syncStateId: number;
        provider: PriorityProviderClient;
        mappingRules: ReturnType<typeof parseMappingRules>;
        effectiveSyncMode: ConnectorSyncMode;
        importJobId: string;
        userId?: string;
        runStartedAt: number;
        onPageFetched: () => void;
    }) {
        const stats: EntitySyncStats = {
            pulled: 0,
            success: 0,
            failed: 0,
            skipped: 0,
        };
        const affectedCustomerIds: number[] = [];
        let capped = false;
        let hadFailure = false;
        let errorMessage: string | undefined;
        let errorType: string | undefined;
        let pagesThisRun = 0;
        let maxUpdatedAt: Date | null = null;

        const syncState = await prisma.connectorSyncState.findUnique({
            where: { id: params.syncStateId },
        });
        let cursor: string | null = syncState?.backfill_cursor ?? null;
        let totalRecordsPulled = syncState?.backfill_records_pulled ?? 0;

        const since =
            params.effectiveSyncMode === "INCREMENTAL" &&
            syncState?.last_max_updated_at
                ? syncState.last_max_updated_at
                : null;

        while (true) {
            if (
                pagesThisRun >= params.connector.backfill_max_pages_per_run ||
                Date.now() - params.runStartedAt >=
                    params.connector.backfill_max_duration_seconds * 1000
            ) {
                capped = true;
                break;
            }

            let page;
            try {
                page = await this.pullWithRetry(params.provider, params.entityType, {
                    since,
                    cursor,
                    overlapMinutes:
                        params.effectiveSyncMode === "INCREMENTAL"
                            ? params.connector.sync_overlap_minutes
                            : 0,
                });
            } catch (error) {
                hadFailure = true;
                const classified = classifyConnectorError(error);
                errorMessage = classified.message;
                errorType = classified.error_type;
                break;
            }

            params.onPageFetched();
            pagesThisRun += 1;
            stats.pulled += page.records.length;
            totalRecordsPulled += page.records.length;

            const mappedRows: Record<string, unknown>[] = [];
            for (let index = 0; index < page.records.length; index++) {
                const mapped = mapErpRecord(page.records[index], params.mappingRules);
                const validationErrors = validateMappedRow(
                    params.entityType,
                    mapped,
                    index
                );
                if (validationErrors.length > 0) {
                    stats.failed += 1;
                    continue;
                }
                mappedRows.push(mapped);
            }

            const batchSize = params.connector.backfill_import_batch_size;
            for (let i = 0; i < mappedRows.length; i += batchSize) {
                const batch = mappedRows.slice(i, i + batchSize);
                const batchResult = await importMappedEntityBatch(
                    params.entityType,
                    batch,
                    params.connector.account_id,
                    params.userId
                );
                stats.success += batchResult.success;
                stats.failed += batchResult.failed;
                stats.skipped += batchResult.skipped;
                affectedCustomerIds.push(...batchResult.affectedCustomerIds);
            }

            const pageMaxUpdated = extractMaxUpdatedAt(page.records);
            if (pageMaxUpdated && (!maxUpdatedAt || pageMaxUpdated > maxUpdatedAt)) {
                maxUpdatedAt = pageMaxUpdated;
            }

            cursor = page.nextCursor;

            if (!page.hasMore) {
                await prisma.connectorSyncState.update({
                    where: { id: params.syncStateId },
                    data: {
                        backfill_completed: true,
                        backfill_completed_at: new Date(),
                        backfill_cursor: null,
                        backfill_records_pulled: totalRecordsPulled,
                        backfill_last_checkpoint_at: new Date(),
                        last_max_updated_at:
                            maxUpdatedAt ?? syncState?.last_max_updated_at,
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_error: null,
                    },
                });
                break;
            }

            await prisma.connectorSyncState.update({
                where: { id: params.syncStateId },
                data: {
                    backfill_cursor: cursor,
                    backfill_records_pulled: totalRecordsPulled,
                    backfill_last_checkpoint_at: new Date(),
                    last_attempt_at: new Date(),
                    last_error: null,
                },
            });
        }

        if (
            params.effectiveSyncMode === "INCREMENTAL" &&
            !hadFailure &&
            !capped &&
            maxUpdatedAt
        ) {
            await prisma.connectorSyncState.update({
                where: { id: params.syncStateId },
                data: {
                    last_max_updated_at: maxUpdatedAt,
                    last_successful_run_at: new Date(),
                    last_attempt_at: new Date(),
                },
            });
        }

        return {
            stats,
            capped,
            hadFailure,
            errorMessage,
            errorType,
            affectedCustomerIds: Array.from(new Set(affectedCustomerIds)),
        };
    }

    private async pullWithRetry(
        provider: PriorityProviderClient,
        entityType: PriorityEntityImportType,
        options: {
            since: Date | null;
            cursor: string | null;
            overlapMinutes: number;
        }
    ) {
        let lastError: unknown;
        for (let attempt = 0; attempt <= CONNECTOR_RETRY_BACKOFF_MS.length; attempt++) {
            try {
                return await provider.pull(entityType, {
                    since: options.since,
                    cursor: options.cursor,
                    overlapMinutes: options.overlapMinutes,
                });
            } catch (error) {
                lastError = error;
                const classified = classifyConnectorError(error);
                if (!classified.retryable || attempt >= CONNECTOR_RETRY_BACKOFF_MS.length) {
                    throw error;
                }
                await sleepMs(CONNECTOR_RETRY_BACKOFF_MS[attempt]);
            }
        }
        throw lastError;
    }

    private getEnabledEntities(connector: BillingConnector): ImportType[] {
        const raw = connector.enabled_entities;
        if (!Array.isArray(raw)) {
            return ENTITY_ORDER;
        }
        return raw.filter(
            (entity): entity is PriorityEntityImportType =>
                typeof entity === "string" &&
                isPriorityEntityImportType(entity as ImportType)
        );
    }

    private async logSyncStep(details: {
        accountId: number;
        connectorId: number;
        provider: string;
        syncMode: string;
        trigger: string;
        status: string;
        errorType?: string;
        correlationId?: string;
        syncExecutionId: string;
        message: string;
        entityType?: string;
    }) {
        await mongoLog.logMessage({
            level: LogLevel.ERROR,
            message: details.message,
            source: "billing_connector.sync",
            account_id: details.accountId,
            correlation_id: details.correlationId,
            details: {
                account_id: details.accountId,
                connector_id: details.connectorId,
                provider: details.provider,
                sync_mode: details.syncMode,
                trigger: details.trigger,
                status: details.status,
                error_type: details.errorType,
                correlation_id: details.correlationId,
                sync_execution_id: details.syncExecutionId,
                entity_type: details.entityType,
            },
        });
    }
}

export const billingConnectorSyncService =
    BillingConnectorSyncService.getInstance();
