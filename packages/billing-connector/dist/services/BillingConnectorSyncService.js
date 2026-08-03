"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingConnectorSyncService = exports.BillingConnectorSyncService = void 0;
const client_1 = require("@prisma/client");
const metrics = __importStar(require("@/lib/metrics"));
const prisma_1 = require("@/lib/prisma");
const connectorErrorClassification_1 = require("@/server/integrations/billing/connectorErrorClassification");
const connectorEntityImporter_1 = require("@/server/integrations/billing/connectorEntityImporter");
const staleSyncExecutionSweeper_1 = require("@/server/integrations/billing/staleSyncExecutionSweeper");
const PriorityProviderClient_1 = require("@/server/integrations/priority/PriorityProviderClient");
const priorityApiContract_1 = require("@/server/integrations/priority/priorityApiContract");
const ConnectorFieldMappingService_1 = require("@/server/services/ConnectorFieldMappingService");
const ConnectorSyncExecutionService_1 = require("@/server/services/ConnectorSyncExecutionService");
const ImportJobService_1 = require("@/server/services/ImportJobService");
const updateAccountLastSyncDate_1 = require("@/server/services/import/updateAccountLastSyncDate");
const postImportOverdueMetrics_1 = require("@/server/services/creditInsurance/postImportOverdueMetrics");
const importArReplayService_1 = require("@/server/services/import/importArReplayService");
const MongoLogService_1 = require("@/server/services/MongoLogService");
const billingConnectorCrypto_1 = require("@/server/utils/billingConnectorCrypto");
const connectorFieldUtils_1 = require("@/server/utils/connectorFieldUtils");
const enums_1 = require("@/types/enums");
/**
 * Entity ingest order per PRD (D6): Customer → Payment → Invoice → Contact.
 * Replay and maturity run as orchestration steps after Invoice (not ERP entity
 * types), before Contact, so AR math is settled before non-AR entities.
 */
const ENTITY_ORDER = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];
const mongoLog = new MongoLogService_1.MongoLogService();
const ANTI_SPAM_MS = 2 * 60 * 1000;
class BillingConnectorSyncService {
    static getInstance() {
        if (!BillingConnectorSyncService.instance) {
            BillingConnectorSyncService.instance =
                new BillingConnectorSyncService();
        }
        return BillingConnectorSyncService.instance;
    }
    async runSync(options) {
        const startedAt = Date.now();
        const mappingService = ConnectorFieldMappingService_1.ConnectorFieldMappingService.getInstance();
        if (options.mode !== "preview") {
            await mappingService.assertMappingsCompleteForEnabledEntities(options.accountId);
        }
        const connector = await prisma_1.prisma.billingConnector.findUnique({
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
            throw Object.assign(new Error("Connector is in error state — fix credentials first"), { statusCode: 409, code: "CONNECTOR_IN_ERROR" });
        }
        if (options.mode === "incremental" &&
            connector.sync_mode !== "INCREMENTAL") {
            throw Object.assign(new Error("Backfill is not complete yet"), {
                statusCode: 409,
                code: "BACKFILL_NOT_COMPLETE",
            });
        }
        await (0, staleSyncExecutionSweeper_1.sweepStaleSyncExecutions)(connector.id, connector.account_id, connector.provider, connector.backfill_max_duration_seconds);
        const running = await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.findLatestRunning(connector.id);
        if (running) {
            throw Object.assign(new Error("A sync is already running"), {
                statusCode: 409,
                code: "SYNC_ALREADY_RUNNING",
            });
        }
        if (!options.skipAntiSpam && options.mode !== "preview") {
            const lastCompleted = await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.getLastCompletedAt(connector.id);
            if (lastCompleted &&
                Date.now() - lastCompleted.getTime() < ANTI_SPAM_MS) {
                throw Object.assign(new Error("Please wait before starting another sync"), { statusCode: 429, code: "TOO_MANY_REQUESTS" });
            }
        }
        const enabledEntities = this.getEnabledEntities(connector);
        const effectiveSyncMode = options.mode === "incremental"
            ? "INCREMENTAL"
            : options.mode === "backfill"
                ? "BACKFILL"
                : connector.sync_mode;
        const mappingSnapshotHash = Object.fromEntries(connector.ConnectorFieldMapping.map((row) => [
            row.import_type,
            ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.hashMapping(row.mapping),
        ]));
        const execution = await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.createExecution({
            connectorId: connector.id,
            accountId: connector.account_id,
            provider: connector.provider,
            trigger: options.trigger,
            syncMode: effectiveSyncMode,
            correlationId: options.correlationId,
            mappingSnapshotHash,
        });
        const entityStats = {};
        const importJobIds = {};
        let runStatus = "SUCCESS";
        let topError;
        let topErrorType;
        let pagesFetched = 0;
        // Accumulate affected customer IDs from Payment and Invoice ingests for
        // the replay and maturity orchestration steps that follow Invoice (D6).
        const arAffectedCustomerIds = new Set();
        const provider = new PriorityProviderClient_1.PriorityProviderClient({
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials: (0, billingConnectorCrypto_1.decryptCredentials)(connector.credentials_encrypted),
        });
        const mappingByType = new Map(connector.ConnectorFieldMapping.map((row) => [
            row.import_type,
            (0, connectorFieldUtils_1.parseMappingRules)(row.mapping),
        ]));
        const syncStateByEntity = new Map(connector.ConnectorSyncState.map((row) => [row.entity_type, row]));
        if (options.mode === "backfill" &&
            !connector.backfill_started_at) {
            await prisma_1.prisma.billingConnector.update({
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
                    throw new Error(`Missing ConnectorSyncState for ${entityType}`);
                }
                if (effectiveSyncMode === "BACKFILL" &&
                    syncState.backfill_completed) {
                    continue;
                }
                if (effectiveSyncMode === "INCREMENTAL" &&
                    !syncState.backfill_completed) {
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
                const importJob = await ImportJobService_1.ImportJobService.createImportJob({
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
                }, options.userId);
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
                await ImportJobService_1.ImportJobService.updateImportJobStatus(importJob.id, entityResult.capped
                    ? client_1.ImportStatus.Processing
                    : client_1.ImportStatus.Completed, {
                    processed_records: entityResult.stats.pulled,
                    successful_records: entityResult.stats.success,
                    failed_records: entityResult.stats.failed,
                });
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
                    entityResult.affectedCustomerIds.forEach((id) => arAffectedCustomerIds.add(id));
                }
                // After Invoice ingest: run chronological replay, maturity pass,
                // and post-import credit-insurance metrics — before Contact (D6).
                if (entityType === "Invoice") {
                    const replayCustomerIds = Array.from(arAffectedCustomerIds);
                    if (replayCustomerIds.length > 0) {
                        const replaySummary = await (0, importArReplayService_1.replayArImportForCustomers)(replayCustomerIds, connector.account_id);
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
                    const maturityResult = await (0, importArReplayService_1.applyMaturedDeferredPayments)(connector.account_id, startOfTodayUtc);
                    entityStats["_maturity"] = {
                        pulled: maturityResult.matured + maturityResult.deferredRemaining,
                        success: maturityResult.matured,
                        failed: 0,
                        skipped: maturityResult.deferredRemaining,
                    };
                    if (arAffectedCustomerIds.size > 0) {
                        await (0, postImportOverdueMetrics_1.triggerPostImportOverdueMetrics)(replayCustomerIds);
                    }
                }
            }
            const refreshedConnector = await prisma_1.prisma.billingConnector.findUnique({
                where: { id: connector.id },
                include: { ConnectorSyncState: true },
            });
            if (refreshedConnector) {
                const allBackfillDone = enabledEntities.every((entity) => {
                    const state = refreshedConnector.ConnectorSyncState.find((row) => row.entity_type === entity);
                    return state?.backfill_completed === true;
                });
                if (allBackfillDone &&
                    refreshedConnector.sync_mode === "BACKFILL") {
                    await prisma_1.prisma.billingConnector.update({
                        where: { id: connector.id },
                        data: { sync_mode: "INCREMENTAL" },
                    });
                }
                if (options.trigger === "scheduled" &&
                    effectiveSyncMode === "INCREMENTAL" &&
                    runStatus === "SUCCESS") {
                    const allEntitiesSucceeded = enabledEntities.every((entity) => {
                        const stats = entityStats[entity];
                        return stats && stats.failed === 0;
                    });
                    if (allEntitiesSucceeded) {
                        await (0, updateAccountLastSyncDate_1.updateAccountLastSyncDate)(connector.account_id);
                    }
                }
            }
        }
        catch (error) {
            runStatus = "FAILED";
            const classified = (0, connectorErrorClassification_1.classifyConnectorError)(error);
            topError = classified.message;
            topErrorType = classified.error_type;
            if (classified.incrementCircuitBreaker) {
                const updated = await prisma_1.prisma.billingConnector.update({
                    where: { id: connector.id },
                    data: {
                        consecutive_auth_failures: { increment: 1 },
                        last_connection_error: classified.message.slice(0, 500),
                    },
                });
                if (updated.consecutive_auth_failures >= 3) {
                    await prisma_1.prisma.billingConnector.update({
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
        const durationSeconds = Math.max(1, Math.round((completedAt.getTime() - startedAt) / 1000));
        await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.updateExecution(execution._id.toString(), {
            status: runStatus,
            completedAt,
            durationSeconds,
            entityStats,
            importJobIds,
            errorMessage: topError,
            errorType: topErrorType,
            performanceMetrics: { pages_fetched: pagesFetched },
        });
        metrics.billingConnectorSyncTotal.inc({
            provider: connector.provider,
            status: runStatus,
            sync_mode: effectiveSyncMode,
            trigger: options.trigger,
        });
        metrics.billingConnectorSyncDuration.observe({ provider: connector.provider, sync_mode: effectiveSyncMode }, durationSeconds);
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
            ]) {
                if (count > 0) {
                    metrics.billingConnectorRecordsProcessed.inc({
                        provider: connector.provider,
                        entity_type: entityType,
                        result,
                    }, count);
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
    async syncEntity(params) {
        const stats = {
            pulled: 0,
            success: 0,
            failed: 0,
            skipped: 0,
        };
        const affectedCustomerIds = [];
        let capped = false;
        let hadFailure = false;
        let errorMessage;
        let errorType;
        let pagesThisRun = 0;
        let maxUpdatedAt = null;
        const syncState = await prisma_1.prisma.connectorSyncState.findUnique({
            where: { id: params.syncStateId },
        });
        let cursor = syncState?.backfill_cursor ?? null;
        let totalRecordsPulled = syncState?.backfill_records_pulled ?? 0;
        const since = params.effectiveSyncMode === "INCREMENTAL" &&
            syncState?.last_max_updated_at
            ? syncState.last_max_updated_at
            : null;
        while (true) {
            if (pagesThisRun >= params.connector.backfill_max_pages_per_run ||
                Date.now() - params.runStartedAt >=
                    params.connector.backfill_max_duration_seconds * 1000) {
                capped = true;
                break;
            }
            let page;
            try {
                page = await this.pullWithRetry(params.provider, params.entityType, {
                    since,
                    cursor,
                    overlapMinutes: params.effectiveSyncMode === "INCREMENTAL"
                        ? params.connector.sync_overlap_minutes
                        : 0,
                });
            }
            catch (error) {
                hadFailure = true;
                const classified = (0, connectorErrorClassification_1.classifyConnectorError)(error);
                errorMessage = classified.message;
                errorType = classified.error_type;
                break;
            }
            params.onPageFetched();
            pagesThisRun += 1;
            stats.pulled += page.records.length;
            totalRecordsPulled += page.records.length;
            const mappedRows = [];
            for (let index = 0; index < page.records.length; index++) {
                const mapped = (0, connectorFieldUtils_1.mapErpRecord)(page.records[index], params.mappingRules);
                const validationErrors = (0, connectorFieldUtils_1.validateMappedRow)(params.entityType, mapped, index);
                if (validationErrors.length > 0) {
                    stats.failed += 1;
                    continue;
                }
                mappedRows.push(mapped);
            }
            const batchSize = params.connector.backfill_import_batch_size;
            for (let i = 0; i < mappedRows.length; i += batchSize) {
                const batch = mappedRows.slice(i, i + batchSize);
                const batchResult = await (0, connectorEntityImporter_1.importMappedEntityBatch)(params.entityType, batch, params.connector.account_id, params.userId);
                stats.success += batchResult.success;
                stats.failed += batchResult.failed;
                stats.skipped += batchResult.skipped;
                affectedCustomerIds.push(...batchResult.affectedCustomerIds);
            }
            const pageMaxUpdated = (0, connectorEntityImporter_1.extractMaxUpdatedAt)(page.records);
            if (pageMaxUpdated && (!maxUpdatedAt || pageMaxUpdated > maxUpdatedAt)) {
                maxUpdatedAt = pageMaxUpdated;
            }
            cursor = page.nextCursor;
            if (!page.hasMore) {
                await prisma_1.prisma.connectorSyncState.update({
                    where: { id: params.syncStateId },
                    data: {
                        backfill_completed: true,
                        backfill_completed_at: new Date(),
                        backfill_cursor: null,
                        backfill_records_pulled: totalRecordsPulled,
                        backfill_last_checkpoint_at: new Date(),
                        last_max_updated_at: maxUpdatedAt ?? syncState?.last_max_updated_at,
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_error: null,
                    },
                });
                break;
            }
            await prisma_1.prisma.connectorSyncState.update({
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
        if (params.effectiveSyncMode === "INCREMENTAL" &&
            !hadFailure &&
            !capped &&
            maxUpdatedAt) {
            await prisma_1.prisma.connectorSyncState.update({
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
    async pullWithRetry(provider, entityType, options) {
        let lastError;
        for (let attempt = 0; attempt <= connectorErrorClassification_1.CONNECTOR_RETRY_BACKOFF_MS.length; attempt++) {
            try {
                return await provider.pull(entityType, {
                    since: options.since,
                    cursor: options.cursor,
                    overlapMinutes: options.overlapMinutes,
                });
            }
            catch (error) {
                lastError = error;
                const classified = (0, connectorErrorClassification_1.classifyConnectorError)(error);
                if (!classified.retryable || attempt >= connectorErrorClassification_1.CONNECTOR_RETRY_BACKOFF_MS.length) {
                    throw error;
                }
                await (0, connectorErrorClassification_1.sleepMs)(connectorErrorClassification_1.CONNECTOR_RETRY_BACKOFF_MS[attempt]);
            }
        }
        throw lastError;
    }
    getEnabledEntities(connector) {
        const raw = connector.enabled_entities;
        if (!Array.isArray(raw)) {
            return ENTITY_ORDER;
        }
        return raw.filter((entity) => typeof entity === "string" &&
            (0, priorityApiContract_1.isPriorityEntityImportType)(entity));
    }
    async logSyncStep(details) {
        await mongoLog.logMessage({
            level: enums_1.LogLevel.ERROR,
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
exports.BillingConnectorSyncService = BillingConnectorSyncService;
exports.billingConnectorSyncService = BillingConnectorSyncService.getInstance();
