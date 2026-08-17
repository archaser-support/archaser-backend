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
exports.registerRunningSync = exports.resetConnectorSyncCancelRegistryForTests = exports.clearConnectorSyncCancel = exports.isConnectorSyncCancelRequested = exports.requestConnectorSyncCancel = exports.discoverConnectorFields = exports.runPreviewSync = exports.ConnectorSyncCancelledError = exports.runInProcessSync = exports.ConnectorFeature = exports.PriorityProviderClient = exports.SAMPLE_PAYLOADS_BY_IMPORT_TYPE = exports.PAYMENT_SAMPLES = exports.INVOICE_SAMPLES = exports.CONTACT_SAMPLES = exports.CUSTOMER_SAMPLES = exports.isPriorityEntityImportType = exports.buildIncrementalQueryParams = exports.buildEntityCollectionUrl = exports.getPriorityEntityEndpoint = exports.PRIORITY_ENTITY_ENDPOINTS = exports.priorityApiContract = exports.getImportEntityFieldCatalog = exports.isConnectorFieldTransform = exports.rulesToRecordMapping = exports.computeMappingCompleteness = exports.validateMappedRow = exports.autoMapConnectorRules = exports.buildDefaultMappingRules = exports.discoverFieldPathsFromRecords = exports.flattenObjectPaths = exports.mapErpRecord = exports.applyConnectorTransform = exports.extractNestedValue = exports.parseMappingRules = exports.describeSchedule = exports.cronToPreset = exports.presetToCron = exports.computeNextScheduledSyncAt = exports.hasCronFiredBetween = exports.isConnectorDue = exports.fetchPriorityEntitySetCatalog = exports.discoverPriorityFields = exports.fetchPriorityEntitySamples = exports.testPriorityConnection = exports.assertPriorityProvider = exports.isBillingConnectorEncryptionConfigured = exports.parseStoredConnectorCredentials = exports.decryptCredentials = exports.encryptCredentials = void 0;
exports.updateAccountLastSyncDate = exports.extractMaxUpdatedAt = exports.importMappedEntityBatch = exports.syncDueBillingConnectors = exports.compileEntityPullFilter = exports.PULL_FILTER_OPERATORS = exports.resolveEntityPullFilterOData = exports.toPublicPullFilters = exports.listChangedPullFilterEntities = exports.pullFiltersToPrismaJson = exports.mergePullFiltersPatch = exports.parsePullFiltersMap = exports.computeEntityPreviewPassed = exports.allEnabledEntitiesPreviewPassed = exports.setPreviewPasses = exports.setPreviewPass = exports.clearPreviewPasses = exports.clearPreviewPass = exports.previewPassesToPrismaJson = exports.parsePreviewPassesMap = exports.getDefaultEntitySets = exports.listChangedEntitySetEntities = exports.entitySetCatalogToPrismaJson = exports.parseEntitySetCatalog = exports.resolveEntityCollectionPath = exports.entitySetsToPrismaJson = exports.mergeEntitySetsPatch = exports.parseEntitySetsMap = exports.normalizeEntitySetName = exports.resetConnectorSyncRuntimeForTests = exports.listSyncRuns = exports.upsertSyncRun = exports.clearRunningSync = exports.getRunningSync = void 0;
exports.testBillingConnectorConnection = testBillingConnectorConnection;
// ==============================
// Crypto
// ==============================
var billingConnectorCrypto_1 = require("./utils/billingConnectorCrypto");
Object.defineProperty(exports, "encryptCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.encryptCredentials; } });
Object.defineProperty(exports, "decryptCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.decryptCredentials; } });
Object.defineProperty(exports, "parseStoredConnectorCredentials", { enumerable: true, get: function () { return billingConnectorCrypto_1.parseStoredConnectorCredentials; } });
Object.defineProperty(exports, "isBillingConnectorEncryptionConfigured", { enumerable: true, get: function () { return billingConnectorCrypto_1.isBillingConnectorEncryptionConfigured; } });
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
Object.defineProperty(exports, "fetchPriorityEntitySamples", { enumerable: true, get: function () { return PriorityClient_1.fetchPriorityEntitySamples; } });
Object.defineProperty(exports, "discoverPriorityFields", { enumerable: true, get: function () { return PriorityClient_1.discoverPriorityFields; } });
Object.defineProperty(exports, "fetchPriorityEntitySetCatalog", { enumerable: true, get: function () { return PriorityClient_1.fetchPriorityEntitySetCatalog; } });
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
Object.defineProperty(exports, "mapErpRecord", { enumerable: true, get: function () { return connectorFieldUtils_1.mapErpRecord; } });
Object.defineProperty(exports, "flattenObjectPaths", { enumerable: true, get: function () { return connectorFieldUtils_1.flattenObjectPaths; } });
Object.defineProperty(exports, "discoverFieldPathsFromRecords", { enumerable: true, get: function () { return connectorFieldUtils_1.discoverFieldPathsFromRecords; } });
Object.defineProperty(exports, "buildDefaultMappingRules", { enumerable: true, get: function () { return connectorFieldUtils_1.buildDefaultMappingRules; } });
Object.defineProperty(exports, "autoMapConnectorRules", { enumerable: true, get: function () { return connectorFieldUtils_1.autoMapConnectorRules; } });
Object.defineProperty(exports, "validateMappedRow", { enumerable: true, get: function () { return connectorFieldUtils_1.validateMappedRow; } });
Object.defineProperty(exports, "computeMappingCompleteness", { enumerable: true, get: function () { return connectorFieldUtils_1.computeMappingCompleteness; } });
Object.defineProperty(exports, "rulesToRecordMapping", { enumerable: true, get: function () { return connectorFieldUtils_1.rulesToRecordMapping; } });
Object.defineProperty(exports, "isConnectorFieldTransform", { enumerable: true, get: function () { return connectorFieldUtils_1.isConnectorFieldTransform; } });
Object.defineProperty(exports, "getImportEntityFieldCatalog", { enumerable: true, get: function () { return connectorFieldUtils_1.getImportEntityFieldCatalog; } });
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
var BillingProviderClient_1 = require("./billing/BillingProviderClient");
Object.defineProperty(exports, "ConnectorFeature", { enumerable: true, get: function () { return BillingProviderClient_1.ConnectorFeature; } });
// ==============================
// Sync + import
// ==============================
var runInProcessSync_1 = require("./sync/runInProcessSync");
Object.defineProperty(exports, "runInProcessSync", { enumerable: true, get: function () { return runInProcessSync_1.runInProcessSync; } });
Object.defineProperty(exports, "ConnectorSyncCancelledError", { enumerable: true, get: function () { return runInProcessSync_1.ConnectorSyncCancelledError; } });
var runPreviewSync_1 = require("./sync/runPreviewSync");
Object.defineProperty(exports, "runPreviewSync", { enumerable: true, get: function () { return runPreviewSync_1.runPreviewSync; } });
Object.defineProperty(exports, "discoverConnectorFields", { enumerable: true, get: function () { return runPreviewSync_1.discoverConnectorFields; } });
var connectorSyncCancelRegistry_1 = require("./sync/connectorSyncCancelRegistry");
Object.defineProperty(exports, "requestConnectorSyncCancel", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.requestConnectorSyncCancel; } });
Object.defineProperty(exports, "isConnectorSyncCancelRequested", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.isConnectorSyncCancelRequested; } });
Object.defineProperty(exports, "clearConnectorSyncCancel", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.clearConnectorSyncCancel; } });
Object.defineProperty(exports, "resetConnectorSyncCancelRegistryForTests", { enumerable: true, get: function () { return connectorSyncCancelRegistry_1.resetConnectorSyncCancelRegistryForTests; } });
var connectorSyncRuntime_1 = require("./sync/connectorSyncRuntime");
Object.defineProperty(exports, "registerRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.registerRunningSync; } });
Object.defineProperty(exports, "getRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.getRunningSync; } });
Object.defineProperty(exports, "clearRunningSync", { enumerable: true, get: function () { return connectorSyncRuntime_1.clearRunningSync; } });
Object.defineProperty(exports, "upsertSyncRun", { enumerable: true, get: function () { return connectorSyncRuntime_1.upsertSyncRun; } });
Object.defineProperty(exports, "listSyncRuns", { enumerable: true, get: function () { return connectorSyncRuntime_1.listSyncRuns; } });
Object.defineProperty(exports, "resetConnectorSyncRuntimeForTests", { enumerable: true, get: function () { return connectorSyncRuntime_1.resetConnectorSyncRuntimeForTests; } });
var billingConnectorEntitySets_1 = require("./services/billingConnectorEntitySets");
Object.defineProperty(exports, "normalizeEntitySetName", { enumerable: true, get: function () { return billingConnectorEntitySets_1.normalizeEntitySetName; } });
Object.defineProperty(exports, "parseEntitySetsMap", { enumerable: true, get: function () { return billingConnectorEntitySets_1.parseEntitySetsMap; } });
Object.defineProperty(exports, "mergeEntitySetsPatch", { enumerable: true, get: function () { return billingConnectorEntitySets_1.mergeEntitySetsPatch; } });
Object.defineProperty(exports, "entitySetsToPrismaJson", { enumerable: true, get: function () { return billingConnectorEntitySets_1.entitySetsToPrismaJson; } });
Object.defineProperty(exports, "resolveEntityCollectionPath", { enumerable: true, get: function () { return billingConnectorEntitySets_1.resolveEntityCollectionPath; } });
Object.defineProperty(exports, "parseEntitySetCatalog", { enumerable: true, get: function () { return billingConnectorEntitySets_1.parseEntitySetCatalog; } });
Object.defineProperty(exports, "entitySetCatalogToPrismaJson", { enumerable: true, get: function () { return billingConnectorEntitySets_1.entitySetCatalogToPrismaJson; } });
Object.defineProperty(exports, "listChangedEntitySetEntities", { enumerable: true, get: function () { return billingConnectorEntitySets_1.listChangedEntitySetEntities; } });
Object.defineProperty(exports, "getDefaultEntitySets", { enumerable: true, get: function () { return billingConnectorEntitySets_1.getDefaultEntitySets; } });
var billingConnectorPreviewPasses_1 = require("./services/billingConnectorPreviewPasses");
Object.defineProperty(exports, "parsePreviewPassesMap", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.parsePreviewPassesMap; } });
Object.defineProperty(exports, "previewPassesToPrismaJson", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.previewPassesToPrismaJson; } });
Object.defineProperty(exports, "clearPreviewPass", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.clearPreviewPass; } });
Object.defineProperty(exports, "clearPreviewPasses", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.clearPreviewPasses; } });
Object.defineProperty(exports, "setPreviewPass", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.setPreviewPass; } });
Object.defineProperty(exports, "setPreviewPasses", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.setPreviewPasses; } });
Object.defineProperty(exports, "allEnabledEntitiesPreviewPassed", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.allEnabledEntitiesPreviewPassed; } });
Object.defineProperty(exports, "computeEntityPreviewPassed", { enumerable: true, get: function () { return billingConnectorPreviewPasses_1.computeEntityPreviewPassed; } });
var billingConnectorPullFilters_1 = require("./services/billingConnectorPullFilters");
Object.defineProperty(exports, "parsePullFiltersMap", { enumerable: true, get: function () { return billingConnectorPullFilters_1.parsePullFiltersMap; } });
Object.defineProperty(exports, "mergePullFiltersPatch", { enumerable: true, get: function () { return billingConnectorPullFilters_1.mergePullFiltersPatch; } });
Object.defineProperty(exports, "pullFiltersToPrismaJson", { enumerable: true, get: function () { return billingConnectorPullFilters_1.pullFiltersToPrismaJson; } });
Object.defineProperty(exports, "listChangedPullFilterEntities", { enumerable: true, get: function () { return billingConnectorPullFilters_1.listChangedPullFilterEntities; } });
Object.defineProperty(exports, "toPublicPullFilters", { enumerable: true, get: function () { return billingConnectorPullFilters_1.toPublicPullFilters; } });
Object.defineProperty(exports, "resolveEntityPullFilterOData", { enumerable: true, get: function () { return billingConnectorPullFilters_1.resolveEntityPullFilterOData; } });
Object.defineProperty(exports, "PULL_FILTER_OPERATORS", { enumerable: true, get: function () { return billingConnectorPullFilters_1.PULL_FILTER_OPERATORS; } });
var billingConnectorPullFilterCompile_1 = require("./services/billingConnectorPullFilterCompile");
Object.defineProperty(exports, "compileEntityPullFilter", { enumerable: true, get: function () { return billingConnectorPullFilterCompile_1.compileEntityPullFilter; } });
var syncDueBillingConnectors_1 = require("./services/syncDueBillingConnectors");
Object.defineProperty(exports, "syncDueBillingConnectors", { enumerable: true, get: function () { return syncDueBillingConnectors_1.syncDueBillingConnectors; } });
var entityImporter_1 = require("./import/entityImporter");
Object.defineProperty(exports, "importMappedEntityBatch", { enumerable: true, get: function () { return entityImporter_1.importMappedEntityBatch; } });
Object.defineProperty(exports, "extractMaxUpdatedAt", { enumerable: true, get: function () { return entityImporter_1.extractMaxUpdatedAt; } });
Object.defineProperty(exports, "updateAccountLastSyncDate", { enumerable: true, get: function () { return entityImporter_1.updateAccountLastSyncDate; } });
