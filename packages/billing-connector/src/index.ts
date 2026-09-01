// ==============================
// Crypto
// ==============================
export {
    encryptCredentials,
    decryptCredentials,
    isBillingConnectorEncryptionConfigured,
    parseStoredConnectorCredentials,
} from "./utils/billingConnectorCrypto";

// ==============================
// Account extensions (registry)
// ==============================
export {
    ACCOUNT_10149_EXTENSION_KEY,
    SAMPLE_NOOP_EXTENSION_KEY,
    listRegisteredExtensionKeys,
    getRegisteredExtension,
    isRegisteredExtensionKey,
    resolveExtensionAttachmentInput,
    resolveAccountBillingExtension,
    type BillingAccountExtension,
    type ExtensionAfterPaymentLinkedContext,
    type ExtensionAfterPaymentLinkedResult,
    type ExtensionAttachmentUpsertInput,
    type ExtensionAttachmentUpsertPatch,
    type ExtensionCreditPaymentCloseInput,
    type ExtensionEntityType,
    type ExtensionLinkedPayment,
    type ExtensionMappedBatch,
    type ExtensionPaymentLinkedCandidate,
    type ExtensionSyncWindow,
    type ExtensionTransformContext,
} from "./extensions";

// ==============================
// Provider validation (D68)
// ==============================
export { assertPriorityProvider } from "./provider";

// ==============================
// Connection testing
// ==============================
export { testPriorityConnection } from "./priority/PriorityClient";
export type {
    PriorityConnectionConfig,
    PriorityTestConnectionResult,
} from "./priority/PriorityClient";

export interface TestBillingConnectorConnectionOptions {
    provider: string;
    authType: "API_KEY" | "BASIC" | "OAUTH2_CLIENT_CREDENTIALS";
    baseUrl: string;
    credentials: Record<string, unknown>;
}

export async function testBillingConnectorConnection(
    options: TestBillingConnectorConnectionOptions
): Promise<{ ok: boolean; error?: string; testedAt: Date }> {
    const { assertPriorityProvider } = await import("./provider");
    assertPriorityProvider(options.provider);

    const { testPriorityConnection } = await import("./priority/PriorityClient");
    return testPriorityConnection({
        baseUrl: options.baseUrl,
        authType: options.authType,
        credentials: options.credentials,
    });
}

// ==============================
// Schedule helpers
// ==============================
export {
    isConnectorDue,
    hasCronFiredBetween,
    computeNextScheduledSyncAt,
    presetToCron,
    cronToPreset,
    describeSchedule,
    type ConnectorScheduleSyncMode,
    type SchedulePreset,
    type ConnectorDueCheckInput,
    type PresetToCronOptions,
    type CronToPresetResult,
} from "./services/billingConnectorSchedule";

// ==============================
// Field utils & Priority contract
// ==============================
export {
    parseMappingRules,
    extractNestedValue,
    applyConnectorTransform,
    toErpDateOnly,
    parseErpDateOnly,
    mapErpRecord,
    flattenObjectPaths,
    discoverFieldPathsFromRecords,
    buildDefaultMappingRules,
    autoMapConnectorRules,
    validateMappedRow,
    computeMappingCompleteness,
    rulesToRecordMapping,
    isConnectorFieldTransform,
    type MappingRule,
    type ConnectorFieldTransform,
} from "./utils/connectorFieldUtils";

export {
    priorityApiContract,
    PRIORITY_ENTITY_ENDPOINTS,
    getPriorityEntityEndpoint,
    buildEntityCollectionUrl,
    buildIncrementalQueryParams,
    isPriorityEntityImportType,
    type PriorityEntityImportType,
    type PriorityApiContract,
    type PriorityEntityEndpointContract,
} from "./priority/priorityApiContract";

export {
    CUSTOMER_SAMPLES,
    CONTACT_SAMPLES,
    INVOICE_SAMPLES,
    PAYMENT_SAMPLES,
    SAMPLE_PAYLOADS_BY_IMPORT_TYPE,
} from "./priority/samplePayloads";

export { PriorityProviderClient } from "./priority/PriorityProviderClient";
export { odataSelectFieldsFromMapping } from "./priority/prioritySelectFields";
export {
    ConnectorFeature,
    type BillingProviderClient,
    type SourceField,
    type PullPage,
    type PullOptions,
} from "./billing/BillingProviderClient";

// ==============================
// Sync + import
// ==============================
export {
    runInProcessSync,
    type RunInProcessSyncOptions,
    type RunInProcessSyncResult,
} from "./sync/runInProcessSync";

export {
    BILLING_CONNECTOR_SYNC_SOURCE,
    createBillingConnectorMetricsSinkFromProm,
    emitBillingConnectorSyncFinish,
    emitBillingConnectorSyncStart,
    getDefaultBillingConnectorMetricsSink,
    resolveSyncErrorType,
    resolveSyncExecutionStatus,
    setDefaultBillingConnectorMetricsSink,
    type BillingConnectorObservabilityOptions,
    type BillingConnectorSyncMetricsSink,
    type BillingConnectorSyncStatus,
} from "./observability";

export {
    runPreviewSync,
    discoverConnectorFields,
} from "./sync/runPreviewSync";

export { fetchPriorityEntitySetCatalog } from "./priority/PriorityClient";

export { getImportEntityFieldCatalog } from "./utils/connectorFieldUtils";

export {
    allEnabledEntitiesPreviewPassed,
    clearPreviewPass,
    clearPreviewPasses,
    parsePreviewPassesMap,
    previewPassesToPrismaJson,
} from "./services/billingConnectorPreviewPasses";

export {
    entitySetCatalogToPrismaJson,
    entitySetsToPrismaJson,
    getDefaultEntitySets,
    listChangedEntitySetEntities,
    mergeEntitySetsPatch,
    parseEntitySetCatalog,
    parseEntitySetsMap,
    type EntitySetsMap,
} from "./services/billingConnectorEntitySets";

export {
    listChangedPullFilterEntities,
    mergePullFiltersPatch,
    pullFiltersToPrismaJson,
    resolveEntityPullFilterOData,
    resolveImportPullFilterOData,
    toPublicPullFilters,
    type PullFiltersMap,
} from "./services/billingConnectorPullFilters";

export {
    AR_REPLAY_ENTITY_STATS_KEY,
    LIVE_REFRESH_ENTITY_STATS_KEY,
    MATURITY_ENTITY_STATS_KEY,
    POST_INGEST_ENTITY_STATS_KEY,
    PROCESS_OVERDUE_ENTITY_STATS_KEY,
    PENDING_CLOSES_ENTITY_STATS_KEY,
    BALANCES_ENTITY_STATS_KEY,
    clearRunningSync,
    getRunningSync,
    listSyncRuns,
    registerRunningSync,
    upsertSyncRun,
    patchSyncRunEntityStats,
    entityStatsFromCounts,
    type ConnectorSyncRunSummary,
} from "./sync/connectorSyncRuntime";

export {
    requestConnectorSyncCancel,
    isConnectorSyncCancelRequested,
} from "./sync/connectorSyncCancelRegistry";

export {
    runStagedExtensionSync,
    planDefaultSyncWindows,
    STAGED_ENTITY_ORDER,
    type RunStagedExtensionSyncOptions,
    type RunStagedExtensionSyncResult,
    type StagedWindowOutcome,
} from "./sync/stagedExtensionSync";

export {
    runInlineArPostIngestTailSteps,
    AR_POST_INGEST_CUSTOMER_CHUNK,
    type RunInlineArPostIngestTailStepsParams,
} from "./sync/arPostIngestTailSteps";

export {
    runArPostIngestViaHost,
    DEFERRED_CI_POST_INGEST_STEPS,
    invokeConnectorArPostIngest,
    refreshInsuranceTargetDatesViaHost,
    registerArPostIngestOrchestrator,
    isArPostIngestOrchestratorRegistered,
    resetArPostIngestOrchestratorForTests,
    type ArPostIngestHostFn,
    type ArPostIngestHostInput,
    type ArPostIngestOrchestratorFn,
    type ArPostIngestOrchestratorResult,
    type DeferredArPostIngestStep,
    type PostIngestDrainScheduleResult,
} from "./credit/arPostIngestHost";

export {
    syncDueBillingConnectors,
    type SyncDueBillingConnectorsOptions,
    type SyncDueBillingConnectorsResult,
} from "./services/syncDueBillingConnectors";

// ==============================
// Sync history (Mongo)
// ==============================
export {
    ensureMongoConnection,
    createRunningExecution,
    completeExecution,
    markExecutionCancelled,
    touchExecutionProgress,
    deferExecutionCompletionUntilPostIngestDrain,
    listAwaitingPostIngestDrainExecutions,
    finalizeAwaitingPostIngestDrainExecutions,
    createSyncProgressHeartbeat,
    touchAwaitingPostIngestDrainProgress,
    finalizeSyncHistoryAfterRun,
    listExecutionsForAccount,
    listRunningSyncAccountIds,
    sweepStaleRunning,
    syncHistoryExecutionToSummary,
    useMemorySyncHistoryStoreForTests,
    resetSyncHistoryStoreForTests,
    HEARTBEAT_INTERVAL_SECONDS,
    HISTORY_WINDOW_DAYS,
    STALE_RUNNING_HOURS,
    defaultSinceDate,
    type CompleteExecutionInput,
    type CreateRunningExecutionInput,
    type DeferCompletionUntilPostIngestDrainInput,
    type FinalizeAwaitingPostIngestDrainOptions,
    type ListExecutionsOptions,
    type MarkExecutionCancelledInput,
    type SweepStaleRunningOptions,
    type SyncHistoryExecution,
    type ConnectorExecutionStatus,
    type ConnectorSyncTrigger,
    type SyncHistoryEntityStats,
    type TouchProgressInput,
} from "./syncHistory";

export {
    importMappedEntityBatch,
    extractMaxUpdatedAt,
    shouldSkipReportingBreachOnConnectorWrite,
    type EntityImportBatchOptions,
    type EntityImportBatchResult,
    type EntityImportRowResult,
    type ImportEntityType,
} from "./import/entityImporter";

export {
    applyMaturedDeferredPayments,
    rawErpRowFromMaturedPayment,
    type MaturityProgress,
    type MaturityResult,
} from "./import/applyMaturedDeferredPayments";

export {
    bulkLinkDeferredPayments,
    linkDeferredPaymentAndRecalc,
    linkDeferredPaymentsAndRecalcBatch,
    recalculateInvoicesFromLinkedPayments,
    resolveInvoicePaidRecalcOptions,
    type BulkDeferredPaymentLink,
    type InvoicePaidRecalcOptions,
    type LinkDeferredPaymentAndRecalcResult,
} from "./invoice/linkDeferredPaymentAndRecalc";

export {
    INVOICE_PAID_TOLERANCE,
    INVOICE_PAID_TOLERANCE_MAX,
    INVOICE_PAID_TOLERANCE_MIN,
    isWithinPaidTolerance,
    normalizeInvoicePaidTolerance,
    resolveInvoicePaidTolerance,
} from "./invoice/invoicePaidTolerance";
