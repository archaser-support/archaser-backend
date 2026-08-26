export { encryptCredentials, decryptCredentials, isBillingConnectorEncryptionConfigured, parseStoredConnectorCredentials, } from "./utils/billingConnectorCrypto";
export { ACCOUNT_10149_EXTENSION_KEY, SAMPLE_NOOP_EXTENSION_KEY, listRegisteredExtensionKeys, getRegisteredExtension, isRegisteredExtensionKey, resolveExtensionAttachmentInput, type BillingAccountExtension, type ExtensionAttachmentUpsertInput, type ExtensionAttachmentUpsertPatch, type ExtensionEntityType, type ExtensionMappedBatch, type ExtensionSyncWindow, type ExtensionTransformContext, } from "./extensions";
export { assertPriorityProvider } from "./provider";
export { testPriorityConnection } from "./priority/PriorityClient";
export type { PriorityConnectionConfig, PriorityTestConnectionResult, } from "./priority/PriorityClient";
export interface TestBillingConnectorConnectionOptions {
    provider: string;
    authType: "API_KEY" | "BASIC" | "OAUTH2_CLIENT_CREDENTIALS";
    baseUrl: string;
    credentials: Record<string, unknown>;
}
export declare function testBillingConnectorConnection(options: TestBillingConnectorConnectionOptions): Promise<{
    ok: boolean;
    error?: string;
    testedAt: Date;
}>;
export { isConnectorDue, hasCronFiredBetween, computeNextScheduledSyncAt, presetToCron, cronToPreset, describeSchedule, type ConnectorScheduleSyncMode, type SchedulePreset, type ConnectorDueCheckInput, type PresetToCronOptions, type CronToPresetResult, } from "./services/billingConnectorSchedule";
export { parseMappingRules, extractNestedValue, applyConnectorTransform, mapErpRecord, flattenObjectPaths, discoverFieldPathsFromRecords, buildDefaultMappingRules, autoMapConnectorRules, validateMappedRow, computeMappingCompleteness, rulesToRecordMapping, isConnectorFieldTransform, type MappingRule, type ConnectorFieldTransform, } from "./utils/connectorFieldUtils";
export { priorityApiContract, PRIORITY_ENTITY_ENDPOINTS, getPriorityEntityEndpoint, buildEntityCollectionUrl, buildIncrementalQueryParams, isPriorityEntityImportType, type PriorityEntityImportType, type PriorityApiContract, type PriorityEntityEndpointContract, } from "./priority/priorityApiContract";
export { CUSTOMER_SAMPLES, CONTACT_SAMPLES, INVOICE_SAMPLES, PAYMENT_SAMPLES, SAMPLE_PAYLOADS_BY_IMPORT_TYPE, } from "./priority/samplePayloads";
export { PriorityProviderClient } from "./priority/PriorityProviderClient";
export { odataSelectFieldsFromMapping } from "./priority/prioritySelectFields";
export { ConnectorFeature, type BillingProviderClient, type SourceField, type PullPage, type PullOptions, } from "./billing/BillingProviderClient";
export { runInProcessSync, type RunInProcessSyncOptions, type RunInProcessSyncResult, } from "./sync/runInProcessSync";
export { runPreviewSync, discoverConnectorFields, } from "./sync/runPreviewSync";
export { fetchPriorityEntitySetCatalog } from "./priority/PriorityClient";
export { getImportEntityFieldCatalog } from "./utils/connectorFieldUtils";
export { allEnabledEntitiesPreviewPassed, clearPreviewPass, clearPreviewPasses, parsePreviewPassesMap, previewPassesToPrismaJson, } from "./services/billingConnectorPreviewPasses";
export { entitySetCatalogToPrismaJson, entitySetsToPrismaJson, getDefaultEntitySets, listChangedEntitySetEntities, mergeEntitySetsPatch, parseEntitySetCatalog, parseEntitySetsMap, type EntitySetsMap, } from "./services/billingConnectorEntitySets";
export { listChangedPullFilterEntities, mergePullFiltersPatch, pullFiltersToPrismaJson, resolveEntityPullFilterOData, resolveImportPullFilterOData, toPublicPullFilters, type PullFiltersMap, } from "./services/billingConnectorPullFilters";
export { clearRunningSync, getRunningSync, listSyncRuns, registerRunningSync, upsertSyncRun, patchSyncRunEntityStats, entityStatsFromCounts, type ConnectorSyncRunSummary, } from "./sync/connectorSyncRuntime";
export { requestConnectorSyncCancel, isConnectorSyncCancelRequested, } from "./sync/connectorSyncCancelRegistry";
export { runStagedExtensionSync, planDefaultSyncWindows, STAGED_ENTITY_ORDER, type RunStagedExtensionSyncOptions, type RunStagedExtensionSyncResult, type StagedWindowOutcome, } from "./sync/stagedExtensionSync";
export { syncDueBillingConnectors, type SyncDueBillingConnectorsResult, } from "./services/syncDueBillingConnectors";
export { importMappedEntityBatch, extractMaxUpdatedAt, shouldSkipReportingBreachOnConnectorWrite, updateAccountLastSyncDate, type EntityImportBatchOptions, type EntityImportBatchResult, type EntityImportRowResult, type ImportEntityType, } from "./import/entityImporter";
