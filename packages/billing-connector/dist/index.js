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
exports.CLEAR_BEFORE_IMPORT_ENTITIES = exports.CLEAR_BEFORE_IMPORT_BATCH_SIZE = exports.runInProcessSync = exports.ConnectorFeature = exports.odataSelectFieldsFromMapping = exports.PriorityProviderClient = exports.SAMPLE_PAYLOADS_BY_IMPORT_TYPE = exports.PAYMENT_SAMPLES = exports.INVOICE_SAMPLES = exports.CONTACT_SAMPLES = exports.CUSTOMER_SAMPLES = exports.isPriorityEntityImportType = exports.buildIncrementalQueryParams = exports.buildEntityCollectionUrl = exports.getPriorityEntityEndpoint = exports.PRIORITY_ENTITY_ENDPOINTS = exports.priorityApiContract = exports.isConnectorFieldTransform = exports.rulesToRecordMapping = exports.computeMappingCompleteness = exports.validateMappedRow = exports.autoMapConnectorRules = exports.buildDefaultMappingRules = exports.discoverFieldPathsFromRecords = exports.flattenObjectPaths = exports.mapErpRecord = exports.parseErpDateOnly = exports.toErpDateOnly = exports.applyConnectorTransform = exports.extractNestedValue = exports.parseMappingRules = exports.describeSchedule = exports.cronToPreset = exports.presetToCron = exports.computeNextScheduledSyncAt = exports.hasCronFiredBetween = exports.isConnectorDue = exports.testPriorityConnection = exports.assertPriorityProvider = exports.resolveAccountBillingExtension = exports.resolveExtensionAttachmentInput = exports.isRegisteredExtensionKey = exports.getRegisteredExtension = exports.listRegisteredExtensionKeys = exports.SAMPLE_NOOP_EXTENSION_KEY = exports.ACCOUNT_10149_EXTENSION_KEY = exports.parseStoredConnectorCredentials = exports.isBillingConnectorEncryptionConfigured = exports.decryptCredentials = exports.encryptCredentials = void 0;
exports.PURGE_ENTITY_STATS_KEY = exports.MATURITY_ENTITY_STATS_KEY = exports.LIVE_REFRESH_ENTITY_STATS_KEY = exports.AR_REPLAY_ENTITY_STATS_KEY = exports.toPublicPullFilters = exports.resolveImportPullFilterOData = exports.resolveEntityPullFilterOData = exports.pullFiltersToPrismaJson = exports.mergePullFiltersPatch = exports.listChangedPullFilterEntities = exports.compileRuntimeCustomerNumberOData = exports.parseEntitySetsMap = exports.parseEntitySetCatalog = exports.mergeEntitySetsPatch = exports.listChangedEntitySetEntities = exports.getDefaultEntitySets = exports.entitySetsToPrismaJson = exports.entitySetCatalogToPrismaJson = exports.previewPassesToPrismaJson = exports.parsePreviewPassesMap = exports.clearPreviewPasses = exports.clearPreviewPass = exports.allEnabledEntitiesPreviewPassed = exports.getImportEntityFieldCatalog = exports.SAMPLE_ERRORS_CAP = exports.emptyEntityImportStatsAccum = exports.applyEntityImportResultToSyncStats = exports.accumulateBatchIntoEntityStats = exports.appendBatchImportIssue = exports.appendEntityImportIssue = exports.formatImportIssueMessage = exports.validateConnectorLiveImportRow = exports.fetchPriorityEntitySetCatalog = exports.discoverConnectorFields = exports.runPreviewSync = exports.setDefaultBillingConnectorMetricsSink = exports.resolveSyncExecutionStatus = exports.resolveSyncErrorType = exports.getDefaultBillingConnectorMetricsSink = exports.emitBillingConnectorSyncStart = exports.emitBillingConnectorSyncFinish = exports.createBillingConnectorMetricsSinkFromProm = exports.BILLING_CONNECTOR_SYNC_SOURCE = exports.resolveClearBeforeImportTargets = exports.resolveAccountCustomerByNumber = exports.resolveAccountCustomerById = exports.parseCustomerNumberForClearBeforeImport = exports.parseCustomerIdForClearBeforeImport = exports.parseClearBeforeImport = exports.clearBeforeImport = void 0;
exports.HEARTBEAT_INTERVAL_SECONDS = exports.resetSyncHistoryStoreForTests = exports.useMemorySyncHistoryStoreForTests = exports.syncHistoryExecutionToSummary = exports.sweepStaleRunning = exports.listRunningSyncAccountIds = exports.listExecutionsForAccount = exports.finalizeSyncHistoryAfterRun = exports.touchAwaitingPostIngestDrainProgress = exports.createSyncProgressHeartbeat = exports.finalizeAwaitingPostIngestDrainExecutions = exports.listAwaitingPostIngestDrainExecutions = exports.deferExecutionCompletionUntilPostIngestDrain = exports.touchExecutionProgress = exports.markExecutionCancelled = exports.completeExecution = exports.createRunningExecution = exports.ensureMongoConnection = exports.syncDueBillingConnectors = exports.resetArPostIngestOrchestratorForTests = exports.isArPostIngestOrchestratorRegistered = exports.registerArPostIngestOrchestrator = exports.refreshInsuranceTargetDatesViaHost = exports.invokeConnectorArPostIngest = exports.DEFERRED_CI_POST_INGEST_STEPS = exports.runArPostIngestViaHost = exports.AR_POST_INGEST_CUSTOMER_CHUNK = exports.runInlineArPostIngestTailSteps = exports.STAGED_ENTITY_ORDER = exports.planDefaultSyncWindows = exports.runStagedExtensionSync = exports.runAcceptedInProcessSync = exports.registerAcceptedInProcessSync = exports.listMergedInProcessSyncRuns = exports.listDurableSyncHistoryRuns = exports.createInProcessSyncHistoryStub = exports.cancelInProcessSyncRun = exports.isConnectorSyncCancelRequested = exports.requestConnectorSyncCancel = exports.entityStatsFromCounts = exports.patchSyncRunEntityStats = exports.upsertSyncRun = exports.registerRunningSync = exports.listSyncRuns = exports.getRunningSync = exports.clearRunningSync = exports.BALANCES_ENTITY_STATS_KEY = exports.PENDING_CLOSES_ENTITY_STATS_KEY = exports.PROCESS_OVERDUE_ENTITY_STATS_KEY = exports.POST_INGEST_ENTITY_STATS_KEY = void 0;
exports.resolveInvoicePaidTolerance = exports.normalizeInvoicePaidTolerance = exports.isWithinPaidTolerance = exports.INVOICE_PAID_TOLERANCE_MIN = exports.INVOICE_PAID_TOLERANCE_MAX = exports.INVOICE_PAID_TOLERANCE = exports.resolveInvoicePaidRecalcOptions = exports.recalculateInvoicesFromLinkedPayments = exports.linkDeferredPaymentsAndRecalcBatch = exports.linkDeferredPaymentAndRecalc = exports.bulkLinkDeferredPayments = exports.rawErpRowFromMaturedPayment = exports.applyMaturedDeferredPayments = exports.shouldSkipReportingBreachOnConnectorWrite = exports.extractMaxUpdatedAt = exports.importMappedEntityBatch = exports.defaultSinceDate = exports.STALE_RUNNING_HOURS = exports.HISTORY_WINDOW_DAYS = void 0;
exports.testBillingConnectorConnection = testBillingConnectorConnection;
// ==============================
// Crypto
// ==============================
var billingConnectorCrypto_1 = require("./utils/billingConnectorCrypto");
Object.defineProperty(exports, "encryptCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.encryptCredentials; } });
Object.defineProperty(exports, "decryptCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.decryptCredentials; } });
Object.defineProperty(exports, "isBillingConnectorEncryptionConfigured", { enumerable: true, get: function () { return billingConnectorCrypto_1.isBillingConnectorEncryptionConfigured; } });
Object.defineProperty(exports, "parseStoredConnectorCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.parseStoredConnectorCredentials; } });
// ==============================
// Account extensions (registry)
// ==============================
var extensions_1 = require("./extensions");
Object.defineProperty(exports, "ACCOUNT_10149_EXTENSION_KEY", { enumerable: true, get: function () { return extensions_1.ACCOUNT_10149_EXTENSION_KEY; } });
Object.defineProperty(exports, "SAMPLE_NOOP_EXTENSION_KEY", { enumerable: true, get: function () { return extensions_1.SAMPLE_NOOP_EXTENSION_KEY; } });
Object.defineProperty(exports, "listRegisteredExtensionKeys", { enumerable: true, get: function () { return extensions_1.listRegisteredExtensionKeys; } });
Object.defineProperty(exports, "getRegisteredExtension", { enumerable: true, get: function () { return extensions_1.getRegisteredExtension; } });
Object.defineProperty(exports, "isRegisteredExtensionKey", { enumerable: true, get: function () { return extensions_1.isRegisteredExtensionKey; } });
Object.defineProperty(exports, "resolveExtensionAttachmentInput", { enumerable: true, get: function () { return extensions_1.resolveExtensionAttachmentInput; } });
Object.defineProperty(exports, "resolveAccountBillingExtension", { enumerable: true, get: function () { return extensions_1.resolveAccountBillingExtension; } });
// ==============================
// Provider validation (D68)
// ==============================
var provider_1 = require("./provider");
Object.defineProperty(exports, "assertPriorityProvider", { enumerable: true, get: function () { return provider_1.assertPriorityProvider; } });
// ==============================
// Connection testing
// ==============================
var PriorityClient_1 = require("./priority/PriorityClient");
Object.defineProperty(exports, "testPriorityConnection", { enumerable: true, get: function () { return PriorityClient_1.testPriorityConnection; } });
async function testBillingConnectorConnection(options) {
    const { assertPriorityProvider } = await Promise.resolve().then(() => __importStar(require("./provider")));
    assertPriorityProvider(options.provider);
    const { testPriorityConnection } = await Promise.resolve().then(() => __importStar(require("./priority/PriorityClient")));
    return testPriorityConnection({
        baseUrl: options.baseUrl,
        authType: options.authType,
        credentials: options.credentials,
    });
}
// ==============================
// Schedule helpers
// ==============================
var billingConnectorSchedule_1 = require("./services/billingConnectorSchedule");
Object.defineProperty(exports, "isConnectorDue", { enumerable: true, get: function () { return billingConnectorSchedule_1.isConnectorDue; } });
Object.defineProperty(exports, "hasCronFiredBetween", { enumerable: true, get: function () { return billingConnectorSchedule_1.hasCronFiredBetween; } });
Object.defineProperty(exports, "computeNextScheduledSyncAt", { enumerable: true, get: function () { return billingConnectorSchedule_1.computeNextScheduledSyncAt; } });
Object.defineProperty(exports, "presetToCron", { enumerable: true, get: function () { return billingConnectorSchedule_1.presetToCron; } });
Object.defineProperty(exports, "cronToPreset", { enumerable: true, get: function () { return billingConnectorSchedule_1.cronToPreset; } });
Object.defineProperty(exports, "describeSchedule", { enumerable: true, get: function () { return billingConnectorSchedule_1.describeSchedule; } });
// ==============================
// Field utils & Priority contract
// ==============================
var connectorFieldUtils_1 = require("./utils/connectorFieldUtils");
Object.defineProperty(exports, "parseMappingRules", { enumerable: true, get: function () { return connectorFieldUtils_1.parseMappingRules; } });
Object.defineProperty(exports, "extractNestedValue", { enumerable: true, get: function () { return connectorFieldUtils_1.extractNestedValue; } });
Object.defineProperty(exports, "applyConnectorTransform", { enumerable: true, get: function () { return connectorFieldUtils_1.applyConnectorTransform; } });
Object.defineProperty(exports, "toErpDateOnly", { enumerable: true, get: function () { return connectorFieldUtils_1.toErpDateOnly; } });
Object.defineProperty(exports, "parseErpDateOnly", { enumerable: true, get: function () { return connectorFieldUtils_1.parseErpDateOnly; } });
Object.defineProperty(exports, "mapErpRecord", { enumerable: true, get: function () { return connectorFieldUtils_1.mapErpRecord; } });
Object.defineProperty(exports, "flattenObjectPaths", { enumerable: true, get: function () { return connectorFieldUtils_1.flattenObjectPaths; } });
Object.defineProperty(exports, "discoverFieldPathsFromRecords", { enumerable: true, get: function () { return connectorFieldUtils_1.discoverFieldPathsFromRecords; } });
Object.defineProperty(exports, "buildDefaultMappingRules", { enumerable: true, get: function () { return connectorFieldUtils_1.buildDefaultMappingRules; } });
Object.defineProperty(exports, "autoMapConnectorRules", { enumerable: true, get: function () { return connectorFieldUtils_1.autoMapConnectorRules; } });
Object.defineProperty(exports, "validateMappedRow", { enumerable: true, get: function () { return connectorFieldUtils_1.validateMappedRow; } });
Object.defineProperty(exports, "computeMappingCompleteness", { enumerable: true, get: function () { return connectorFieldUtils_1.computeMappingCompleteness; } });
Object.defineProperty(exports, "rulesToRecordMapping", { enumerable: true, get: function () { return connectorFieldUtils_1.rulesToRecordMapping; } });
Object.defineProperty(exports, "isConnectorFieldTransform", { enumerable: true, get: function () { return connectorFieldUtils_1.isConnectorFieldTransform; } });
var priorityApiContract_1 = require("./priority/priorityApiContract");
Object.defineProperty(exports, "priorityApiContract", { enumerable: true, get: function () { return priorityApiContract_1.priorityApiContract; } });
Object.defineProperty(exports, "PRIORITY_ENTITY_ENDPOINTS", { enumerable: true, get: function () { return priorityApiContract_1.PRIORITY_ENTITY_ENDPOINTS; } });
Object.defineProperty(exports, "getPriorityEntityEndpoint", { enumerable: true, get: function () { return priorityApiContract_1.getPriorityEntityEndpoint; } });
Object.defineProperty(exports, "buildEntityCollectionUrl", { enumerable: true, get: function () { return priorityApiContract_1.buildEntityCollectionUrl; } });
Object.defineProperty(exports, "buildIncrementalQueryParams", { enumerable: true, get: function () { return priorityApiContract_1.buildIncrementalQueryParams; } });
Object.defineProperty(exports, "isPriorityEntityImportType", { enumerable: true, get: function () { return priorityApiContract_1.isPriorityEntityImportType; } });
var samplePayloads_1 = require("./priority/samplePayloads");
Object.defineProperty(exports, "CUSTOMER_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.CUSTOMER_SAMPLES; } });
Object.defineProperty(exports, "CONTACT_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.CONTACT_SAMPLES; } });
Object.defineProperty(exports, "INVOICE_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.INVOICE_SAMPLES; } });
Object.defineProperty(exports, "PAYMENT_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.PAYMENT_SAMPLES; } });
Object.defineProperty(exports, "SAMPLE_PAYLOADS_BY_IMPORT_TYPE", { enumerable: true, get: function () { return samplePayloads_1.SAMPLE_PAYLOADS_BY_IMPORT_TYPE; } });
var PriorityProviderClient_1 = require("./priority/PriorityProviderClient");
Object.defineProperty(exports, "PriorityProviderClient", { enumerable: true, get: function () { return PriorityProviderClient_1.PriorityProviderClient; } });
var prioritySelectFields_1 = require("./priority/prioritySelectFields");
Object.defineProperty(exports, "odataSelectFieldsFromMapping", { enumerable: true, get: function () { return prioritySelectFields_1.odataSelectFieldsFromMapping; } });
var BillingProviderClient_1 = require("./billing/BillingProviderClient");
Object.defineProperty(exports, "ConnectorFeature", { enumerable: true, get: function () { return BillingProviderClient_1.ConnectorFeature; } });
// ==============================
// Sync + import
// ==============================
var runInProcessSync_1 = require("./sync/runInProcessSync");
Object.defineProperty(exports, "runInProcessSync", { enumerable: true, get: function () { return runInProcessSync_1.runInProcessSync; } });
var clearBeforeImport_1 = require("./purge/clearBeforeImport");
Object.defineProperty(exports, "CLEAR_BEFORE_IMPORT_BATCH_SIZE", { enumerable: true, get: function () { return clearBeforeImport_1.CLEAR_BEFORE_IMPORT_BATCH_SIZE; } });
Object.defineProperty(exports, "CLEAR_BEFORE_IMPORT_ENTITIES", { enumerable: true, get: function () { return clearBeforeImport_1.CLEAR_BEFORE_IMPORT_ENTITIES; } });
Object.defineProperty(exports, "clearBeforeImport", { enumerable: true, get: function () { return clearBeforeImport_1.clearBeforeImport; } });
Object.defineProperty(exports, "parseClearBeforeImport", { enumerable: true, get: function () { return clearBeforeImport_1.parseClearBeforeImport; } });
Object.defineProperty(exports, "parseCustomerIdForClearBeforeImport", { enumerable: true, get: function () { return clearBeforeImport_1.parseCustomerIdForClearBeforeImport; } });
Object.defineProperty(exports, "parseCustomerNumberForClearBeforeImport", { enumerable: true, get: function () { return clearBeforeImport_1.parseCustomerNumberForClearBeforeImport; } });
Object.defineProperty(exports, "resolveAccountCustomerById", { enumerable: true, get: function () { return clearBeforeImport_1.resolveAccountCustomerById; } });
Object.defineProperty(exports, "resolveAccountCustomerByNumber", { enumerable: true, get: function () { return clearBeforeImport_1.resolveAccountCustomerByNumber; } });
Object.defineProperty(exports, "resolveClearBeforeImportTargets", { enumerable: true, get: function () { return clearBeforeImport_1.resolveClearBeforeImportTargets; } });
var observability_1 = require("./observability");
Object.defineProperty(exports, "BILLING_CONNECTOR_SYNC_SOURCE", { enumerable: true, get: function () { return observability_1.BILLING_CONNECTOR_SYNC_SOURCE; } });
Object.defineProperty(exports, "createBillingConnectorMetricsSinkFromProm", { enumerable: true, get: function () { return observability_1.createBillingConnectorMetricsSinkFromProm; } });
Object.defineProperty(exports, "emitBillingConnectorSyncFinish", { enumerable: true, get: function () { return observability_1.emitBillingConnectorSyncFinish; } });
Object.defineProperty(exports, "emitBillingConnectorSyncStart", { enumerable: true, get: function () { return observability_1.emitBillingConnectorSyncStart; } });
Object.defineProperty(exports, "getDefaultBillingConnectorMetricsSink", { enumerable: true, get: function () { return observability_1.getDefaultBillingConnectorMetricsSink; } });
Object.defineProperty(exports, "resolveSyncErrorType", { enumerable: true, get: function () { return observability_1.resolveSyncErrorType; } });
Object.defineProperty(exports, "resolveSyncExecutionStatus", { enumerable: true, get: function () { return observability_1.resolveSyncExecutionStatus; } });
Object.defineProperty(exports, "setDefaultBillingConnectorMetricsSink", { enumerable: true, get: function () { return observability_1.setDefaultBillingConnectorMetricsSink; } });
var runPreviewSync_1 = require("./sync/runPreviewSync");
Object.defineProperty(exports, "runPreviewSync", { enumerable: true, get: function () { return runPreviewSync_1.runPreviewSync; } });
Object.defineProperty(exports, "discoverConnectorFields", { enumerable: true, get: function () { return runPreviewSync_1.discoverConnectorFields; } });
var PriorityClient_2 = require("./priority/PriorityClient");
Object.defineProperty(exports, "fetchPriorityEntitySetCatalog", { enumerable: true, get: function () { return PriorityClient_2.fetchPriorityEntitySetCatalog; } });
var validateConnectorLiveImportRow_1 = require("./import/validateConnectorLiveImportRow");
Object.defineProperty(exports, "validateConnectorLiveImportRow", { enumerable: true, get: function () { return validateConnectorLiveImportRow_1.validateConnectorLiveImportRow; } });
Object.defineProperty(exports, "formatImportIssueMessage", { enumerable: true, get: function () { return validateConnectorLiveImportRow_1.formatImportIssueMessage; } });
var aggregateEntityImportStats_1 = require("./import/aggregateEntityImportStats");
Object.defineProperty(exports, "appendEntityImportIssue", { enumerable: true, get: function () { return aggregateEntityImportStats_1.appendEntityImportIssue; } });
Object.defineProperty(exports, "appendBatchImportIssue", { enumerable: true, get: function () { return aggregateEntityImportStats_1.appendBatchImportIssue; } });
Object.defineProperty(exports, "accumulateBatchIntoEntityStats", { enumerable: true, get: function () { return aggregateEntityImportStats_1.accumulateBatchIntoEntityStats; } });
Object.defineProperty(exports, "applyEntityImportResultToSyncStats", { enumerable: true, get: function () { return aggregateEntityImportStats_1.applyEntityImportResultToSyncStats; } });
Object.defineProperty(exports, "emptyEntityImportStatsAccum", { enumerable: true, get: function () { return aggregateEntityImportStats_1.emptyEntityImportStatsAccum; } });
Object.defineProperty(exports, "SAMPLE_ERRORS_CAP", { enumerable: true, get: function () { return aggregateEntityImportStats_1.SAMPLE_ERRORS_CAP; } });
var connectorFieldUtils_2 = require("./utils/connectorFieldUtils");
Object.defineProperty(exports, "getImportEntityFieldCatalog", { enumerable: true, get: function () { return connectorFieldUtils_2.getImportEntityFieldCatalog; } });
var billingConnectorPreviewPasses_1 = require("./services/billingConnectorPreviewPasses");
Object.defineProperty(exports, "allEnabledEntitiesPreviewPassed", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.allEnabledEntitiesPreviewPassed; } });
Object.defineProperty(exports, "clearPreviewPass", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.clearPreviewPass; } });
Object.defineProperty(exports, "clearPreviewPasses", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.clearPreviewPasses; } });
Object.defineProperty(exports, "parsePreviewPassesMap", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.parsePreviewPassesMap; } });
Object.defineProperty(exports, "previewPassesToPrismaJson", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.previewPassesToPrismaJson; } });
var billingConnectorEntitySets_1 = require("./services/billingConnectorEntitySets");
Object.defineProperty(exports, "entitySetCatalogToPrismaJson", { enumerable: true, get: function () { return billingConnectorEntitySets_1.entitySetCatalogToPrismaJson; } });
Object.defineProperty(exports, "entitySetsToPrismaJson", { enumerable: true, get: function () { return billingConnectorEntitySets_1.entitySetsToPrismaJson; } });
Object.defineProperty(exports, "getDefaultEntitySets", { enumerable: true, get: function () { return billingConnectorEntitySets_1.getDefaultEntitySets; } });
Object.defineProperty(exports, "listChangedEntitySetEntities", { enumerable: true, get: function () { return billingConnectorEntitySets_1.listChangedEntitySetEntities; } });
Object.defineProperty(exports, "mergeEntitySetsPatch", { enumerable: true, get: function () { return billingConnectorEntitySets_1.mergeEntitySetsPatch; } });
Object.defineProperty(exports, "parseEntitySetCatalog", { enumerable: true, get: function () { return billingConnectorEntitySets_1.parseEntitySetCatalog; } });
Object.defineProperty(exports, "parseEntitySetsMap", { enumerable: true, get: function () { return billingConnectorEntitySets_1.parseEntitySetsMap; } });
var billingConnectorPullFilters_1 = require("./services/billingConnectorPullFilters");
Object.defineProperty(exports, "compileRuntimeCustomerNumberOData", { enumerable: true, get: function () { return billingConnectorPullFilters_1.compileRuntimeCustomerNumberOData; } });
Object.defineProperty(exports, "listChangedPullFilterEntities", { enumerable: true, get: function () { return billingConnectorPullFilters_1.listChangedPullFilterEntities; } });
Object.defineProperty(exports, "mergePullFiltersPatch", { enumerable: true, get: function () { return billingConnectorPullFilters_1.mergePullFiltersPatch; } });
Object.defineProperty(exports, "pullFiltersToPrismaJson", { enumerable: true, get: function () { return billingConnectorPullFilters_1.pullFiltersToPrismaJson; } });
Object.defineProperty(exports, "resolveEntityPullFilterOData", { enumerable: true, get: function () { return billingConnectorPullFilters_1.resolveEntityPullFilterOData; } });
Object.defineProperty(exports, "resolveImportPullFilterOData", { enumerable: true, get: function () { return billingConnectorPullFilters_1.resolveImportPullFilterOData; } });
Object.defineProperty(exports, "toPublicPullFilters", { enumerable: true, get: function () { return billingConnectorPullFilters_1.toPublicPullFilters; } });
var connectorSyncRuntime_1 = require("./sync/connectorSyncRuntime");
Object.defineProperty(exports, "AR_REPLAY_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.AR_REPLAY_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "LIVE_REFRESH_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.LIVE_REFRESH_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "MATURITY_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.MATURITY_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "PURGE_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.PURGE_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "POST_INGEST_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.POST_INGEST_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "PROCESS_OVERDUE_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.PROCESS_OVERDUE_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "PENDING_CLOSES_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.PENDING_CLOSES_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "BALANCES_ENTITY_STATS_KEY", { enumerable: true, get: function () { return connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY; } });
Object.defineProperty(exports, "clearRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.clearRunningSync; } });
Object.defineProperty(exports, "getRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.getRunningSync; } });
Object.defineProperty(exports, "listSyncRuns", { enumerable: true, get: function () { return connectorSyncRuntime_1.listSyncRuns; } });
Object.defineProperty(exports, "registerRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.registerRunningSync; } });
Object.defineProperty(exports, "upsertSyncRun", { enumerable: true, get: function () { return connectorSyncRuntime_1.upsertSyncRun; } });
Object.defineProperty(exports, "patchSyncRunEntityStats", { enumerable: true, get: function () { return connectorSyncRuntime_1.patchSyncRunEntityStats; } });
Object.defineProperty(exports, "entityStatsFromCounts", { enumerable: true, get: function () { return connectorSyncRuntime_1.entityStatsFromCounts; } });
var connectorSyncCancelRegistry_1 = require("./sync/connectorSyncCancelRegistry");
Object.defineProperty(exports, "requestConnectorSyncCancel", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.requestConnectorSyncCancel; } });
Object.defineProperty(exports, "isConnectorSyncCancelRequested", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.isConnectorSyncCancelRequested; } });
var inProcessSyncLifecycle_1 = require("./sync/inProcessSyncLifecycle");
Object.defineProperty(exports, "cancelInProcessSyncRun", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.cancelInProcessSyncRun; } });
Object.defineProperty(exports, "createInProcessSyncHistoryStub", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.createInProcessSyncHistoryStub; } });
Object.defineProperty(exports, "listDurableSyncHistoryRuns", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.listDurableSyncHistoryRuns; } });
Object.defineProperty(exports, "listMergedInProcessSyncRuns", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.listMergedInProcessSyncRuns; } });
Object.defineProperty(exports, "registerAcceptedInProcessSync", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.registerAcceptedInProcessSync; } });
Object.defineProperty(exports, "runAcceptedInProcessSync", { enumerable: true, get: function () { return inProcessSyncLifecycle_1.runAcceptedInProcessSync; } });
var stagedExtensionSync_1 = require("./sync/stagedExtensionSync");
Object.defineProperty(exports, "runStagedExtensionSync", { enumerable: true, get: function () { return stagedExtensionSync_1.runStagedExtensionSync; } });
Object.defineProperty(exports, "planDefaultSyncWindows", { enumerable: true, get: function () { return stagedExtensionSync_1.planDefaultSyncWindows; } });
Object.defineProperty(exports, "STAGED_ENTITY_ORDER", { enumerable: true, get: function () { return stagedExtensionSync_1.STAGED_ENTITY_ORDER; } });
var arPostIngestTailSteps_1 = require("./sync/arPostIngestTailSteps");
Object.defineProperty(exports, "runInlineArPostIngestTailSteps", { enumerable: true, get: function () { return arPostIngestTailSteps_1.runInlineArPostIngestTailSteps; } });
Object.defineProperty(exports, "AR_POST_INGEST_CUSTOMER_CHUNK", { enumerable: true, get: function () { return arPostIngestTailSteps_1.AR_POST_INGEST_CUSTOMER_CHUNK; } });
var arPostIngestHost_1 = require("./credit/arPostIngestHost");
Object.defineProperty(exports, "runArPostIngestViaHost", { enumerable: true, get: function () { return arPostIngestHost_1.runArPostIngestViaHost; } });
Object.defineProperty(exports, "DEFERRED_CI_POST_INGEST_STEPS", { enumerable: true, get: function () { return arPostIngestHost_1.DEFERRED_CI_POST_INGEST_STEPS; } });
Object.defineProperty(exports, "invokeConnectorArPostIngest", { enumerable: true, get: function () { return arPostIngestHost_1.invokeConnectorArPostIngest; } });
Object.defineProperty(exports, "refreshInsuranceTargetDatesViaHost", { enumerable: true, get: function () { return arPostIngestHost_1.refreshInsuranceTargetDatesViaHost; } });
Object.defineProperty(exports, "registerArPostIngestOrchestrator", { enumerable: true, get: function () { return arPostIngestHost_1.registerArPostIngestOrchestrator; } });
Object.defineProperty(exports, "isArPostIngestOrchestratorRegistered", { enumerable: true, get: function () { return arPostIngestHost_1.isArPostIngestOrchestratorRegistered; } });
Object.defineProperty(exports, "resetArPostIngestOrchestratorForTests", { enumerable: true, get: function () { return arPostIngestHost_1.resetArPostIngestOrchestratorForTests; } });
var syncDueBillingConnectors_1 = require("./services/syncDueBillingConnectors");
Object.defineProperty(exports, "syncDueBillingConnectors", { enumerable: true, get: function () { return syncDueBillingConnectors_1.syncDueBillingConnectors; } });
// ==============================
// Sync history (Mongo)
// ==============================
var syncHistory_1 = require("./syncHistory");
Object.defineProperty(exports, "ensureMongoConnection", { enumerable: true, get: function () { return syncHistory_1.ensureMongoConnection; } });
Object.defineProperty(exports, "createRunningExecution", { enumerable: true, get: function () { return syncHistory_1.createRunningExecution; } });
Object.defineProperty(exports, "completeExecution", { enumerable: true, get: function () { return syncHistory_1.completeExecution; } });
Object.defineProperty(exports, "markExecutionCancelled", { enumerable: true, get: function () { return syncHistory_1.markExecutionCancelled; } });
Object.defineProperty(exports, "touchExecutionProgress", { enumerable: true, get: function () { return syncHistory_1.touchExecutionProgress; } });
Object.defineProperty(exports, "deferExecutionCompletionUntilPostIngestDrain", { enumerable: true, get: function () { return syncHistory_1.deferExecutionCompletionUntilPostIngestDrain; } });
Object.defineProperty(exports, "listAwaitingPostIngestDrainExecutions", { enumerable: true, get: function () { return syncHistory_1.listAwaitingPostIngestDrainExecutions; } });
Object.defineProperty(exports, "finalizeAwaitingPostIngestDrainExecutions", { enumerable: true, get: function () { return syncHistory_1.finalizeAwaitingPostIngestDrainExecutions; } });
Object.defineProperty(exports, "createSyncProgressHeartbeat", { enumerable: true, get: function () { return syncHistory_1.createSyncProgressHeartbeat; } });
Object.defineProperty(exports, "touchAwaitingPostIngestDrainProgress", { enumerable: true, get: function () { return syncHistory_1.touchAwaitingPostIngestDrainProgress; } });
Object.defineProperty(exports, "finalizeSyncHistoryAfterRun", { enumerable: true, get: function () { return syncHistory_1.finalizeSyncHistoryAfterRun; } });
Object.defineProperty(exports, "listExecutionsForAccount", { enumerable: true, get: function () { return syncHistory_1.listExecutionsForAccount; } });
Object.defineProperty(exports, "listRunningSyncAccountIds", { enumerable: true, get: function () { return syncHistory_1.listRunningSyncAccountIds; } });
Object.defineProperty(exports, "sweepStaleRunning", { enumerable: true, get: function () { return syncHistory_1.sweepStaleRunning; } });
Object.defineProperty(exports, "syncHistoryExecutionToSummary", { enumerable: true, get: function () { return syncHistory_1.syncHistoryExecutionToSummary; } });
Object.defineProperty(exports, "useMemorySyncHistoryStoreForTests", { enumerable: true, get: function () { return syncHistory_1.useMemorySyncHistoryStoreForTests; } });
Object.defineProperty(exports, "resetSyncHistoryStoreForTests", { enumerable: true, get: function () { return syncHistory_1.resetSyncHistoryStoreForTests; } });
Object.defineProperty(exports, "HEARTBEAT_INTERVAL_SECONDS", { enumerable: true, get: function () { return syncHistory_1.HEARTBEAT_INTERVAL_SECONDS; } });
Object.defineProperty(exports, "HISTORY_WINDOW_DAYS", { enumerable: true, get: function () { return syncHistory_1.HISTORY_WINDOW_DAYS; } });
Object.defineProperty(exports, "STALE_RUNNING_HOURS", { enumerable: true, get: function () { return syncHistory_1.STALE_RUNNING_HOURS; } });
Object.defineProperty(exports, "defaultSinceDate", { enumerable: true, get: function () { return syncHistory_1.defaultSinceDate; } });
var entityImporter_1 = require("./import/entityImporter");
Object.defineProperty(exports, "importMappedEntityBatch", { enumerable: true, get: function () { return entityImporter_1.importMappedEntityBatch; } });
Object.defineProperty(exports, "extractMaxUpdatedAt", { enumerable: true, get: function () { return entityImporter_1.extractMaxUpdatedAt; } });
Object.defineProperty(exports, "shouldSkipReportingBreachOnConnectorWrite", { enumerable: true, get: function () { return entityImporter_1.shouldSkipReportingBreachOnConnectorWrite; } });
var applyMaturedDeferredPayments_1 = require("./import/applyMaturedDeferredPayments");
Object.defineProperty(exports, "applyMaturedDeferredPayments", { enumerable: true, get: function () { return applyMaturedDeferredPayments_1.applyMaturedDeferredPayments; } });
Object.defineProperty(exports, "rawErpRowFromMaturedPayment", { enumerable: true, get: function () { return applyMaturedDeferredPayments_1.rawErpRowFromMaturedPayment; } });
var linkDeferredPaymentAndRecalc_1 = require("./invoice/linkDeferredPaymentAndRecalc");
Object.defineProperty(exports, "bulkLinkDeferredPayments", { enumerable: true, get: function () { return linkDeferredPaymentAndRecalc_1.bulkLinkDeferredPayments; } });
Object.defineProperty(exports, "linkDeferredPaymentAndRecalc", { enumerable: true, get: function () { return linkDeferredPaymentAndRecalc_1.linkDeferredPaymentAndRecalc; } });
Object.defineProperty(exports, "linkDeferredPaymentsAndRecalcBatch", { enumerable: true, get: function () { return linkDeferredPaymentAndRecalc_1.linkDeferredPaymentsAndRecalcBatch; } });
Object.defineProperty(exports, "recalculateInvoicesFromLinkedPayments", { enumerable: true, get: function () { return linkDeferredPaymentAndRecalc_1.recalculateInvoicesFromLinkedPayments; } });
Object.defineProperty(exports, "resolveInvoicePaidRecalcOptions", { enumerable: true, get: function () { return linkDeferredPaymentAndRecalc_1.resolveInvoicePaidRecalcOptions; } });
var invoicePaidTolerance_1 = require("./invoice/invoicePaidTolerance");
Object.defineProperty(exports, "INVOICE_PAID_TOLERANCE", { enumerable: true, get: function () { return invoicePaidTolerance_1.INVOICE_PAID_TOLERANCE; } });
Object.defineProperty(exports, "INVOICE_PAID_TOLERANCE_MAX", { enumerable: true, get: function () { return invoicePaidTolerance_1.INVOICE_PAID_TOLERANCE_MAX; } });
Object.defineProperty(exports, "INVOICE_PAID_TOLERANCE_MIN", { enumerable: true, get: function () { return invoicePaidTolerance_1.INVOICE_PAID_TOLERANCE_MIN; } });
Object.defineProperty(exports, "isWithinPaidTolerance", { enumerable: true, get: function () { return invoicePaidTolerance_1.isWithinPaidTolerance; } });
Object.defineProperty(exports, "normalizeInvoicePaidTolerance", { enumerable: true, get: function () { return invoicePaidTolerance_1.normalizeInvoicePaidTolerance; } });
Object.defineProperty(exports, "resolveInvoicePaidTolerance", { enumerable: true, get: function () { return invoicePaidTolerance_1.resolveInvoicePaidTolerance; } });
