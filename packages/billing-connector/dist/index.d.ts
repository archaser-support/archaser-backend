export { encryptCredentials, decryptCredentials, parseStoredConnectorCredentials, isBillingConnectorEncryptionConfigured, } from "./utils/billingConnectorCrypto";
export { assertPriorityProvider } from "./provider";
export { testPriorityConnection, fetchPriorityEntitySamples, discoverPriorityFields, fetchPriorityEntitySetCatalog, } from "./priority/PriorityClient";
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
export { parseMappingRules, extractNestedValue, applyConnectorTransform, mapErpRecord, flattenObjectPaths, discoverFieldPathsFromRecords, buildDefaultMappingRules, autoMapConnectorRules, validateMappedRow, computeMappingCompleteness, rulesToRecordMapping, isConnectorFieldTransform, getImportEntityFieldCatalog, type MappingRule, type ConnectorFieldTransform, } from "./utils/connectorFieldUtils";
export { priorityApiContract, PRIORITY_ENTITY_ENDPOINTS, getPriorityEntityEndpoint, buildEntityCollectionUrl, buildIncrementalQueryParams, isPriorityEntityImportType, type PriorityEntityImportType, type PriorityApiContract, type PriorityEntityEndpointContract, } from "./priority/priorityApiContract";
export { CUSTOMER_SAMPLES, CONTACT_SAMPLES, INVOICE_SAMPLES, PAYMENT_SAMPLES, SAMPLE_PAYLOADS_BY_IMPORT_TYPE, } from "./priority/samplePayloads";
export { PriorityProviderClient } from "./priority/PriorityProviderClient";
export { ConnectorFeature, type BillingProviderClient, type SourceField, type PullPage, type PullOptions, } from "./billing/BillingProviderClient";
export { runInProcessSync, ConnectorSyncCancelledError, type RunInProcessSyncOptions, type RunInProcessSyncResult, } from "./sync/runInProcessSync";
export { runPreviewSync, discoverConnectorFields, type PreviewEntityResult, type PreviewSyncResult, } from "./sync/runPreviewSync";
export { requestConnectorSyncCancel, isConnectorSyncCancelRequested, clearConnectorSyncCancel, resetConnectorSyncCancelRegistryForTests, } from "./sync/connectorSyncCancelRegistry";
export { registerRunningSync, getRunningSync, clearRunningSync, upsertSyncRun, listSyncRuns, resetConnectorSyncRuntimeForTests, type ConnectorSyncRunSummary, type RunningConnectorSync, } from "./sync/connectorSyncRuntime";
export { normalizeEntitySetName, parseEntitySetsMap, mergeEntitySetsPatch, entitySetsToPrismaJson, resolveEntityCollectionPath, parseEntitySetCatalog, entitySetCatalogToPrismaJson, listChangedEntitySetEntities, getDefaultEntitySets, type EntitySetsMap, } from "./services/billingConnectorEntitySets";
export { parsePreviewPassesMap, previewPassesToPrismaJson, clearPreviewPass, clearPreviewPasses, setPreviewPass, setPreviewPasses, allEnabledEntitiesPreviewPassed, computeEntityPreviewPassed, type EntityPreviewPass, type PreviewPassesMap, } from "./services/billingConnectorPreviewPasses";
export { parsePullFiltersMap, mergePullFiltersPatch, pullFiltersToPrismaJson, listChangedPullFilterEntities, toPublicPullFilters, resolveEntityPullFilterOData, PULL_FILTER_OPERATORS, type PullFiltersMap, type EntityPullFilterConfig, } from "./services/billingConnectorPullFilters";
export { compileEntityPullFilter } from "./services/billingConnectorPullFilterCompile";
export { syncDueBillingConnectors, type SyncDueBillingConnectorsResult, } from "./services/syncDueBillingConnectors";
export { importMappedEntityBatch, extractMaxUpdatedAt, updateAccountLastSyncDate, type EntityImportBatchResult, type ImportEntityType, } from "./import/entityImporter";
