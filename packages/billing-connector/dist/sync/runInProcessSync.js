"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInProcessSync = runInProcessSync;
const extensions_1 = require("../extensions");
const PriorityProviderClient_1 = require("../priority/PriorityProviderClient");
const PriorityClient_1 = require("../priority/PriorityClient");
const provider_1 = require("../provider");
const billingConnectorCrypto_1 = require("../utils/billingConnectorCrypto");
const entityImporter_1 = require("../import/entityImporter");
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
const priorityApiContract_1 = require("../priority/priorityApiContract");
const prioritySelectFields_1 = require("../priority/prioritySelectFields");
const billingConnectorEntitySets_1 = require("../services/billingConnectorEntitySets");
const billingConnectorPullFilters_1 = require("../services/billingConnectorPullFilters");
const clearBeforeImport_1 = require("../purge/clearBeforeImport");
const connectorSyncCancelRegistry_1 = require("./connectorSyncCancelRegistry");
const connectorSyncRuntime_1 = require("./connectorSyncRuntime");
const stagedExtensionSync_1 = require("./stagedExtensionSync");
const recalculateCustomerAmountsHost_1 = require("../customers/recalculateCustomerAmountsHost");
const arPostIngestTailSteps_1 = require("./arPostIngestTailSteps");
const processOverdueTailStep_1 = require("./processOverdueTailStep");
const observability_1 = require("../observability");
const ENTITY_ORDER = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];
function emitSyncLog(onLog, message) {
    onLog?.(message);
}
function emptyStats() {
    return {
        customersProcessed: 0,
        contactsProcessed: 0,
        invoicesProcessed: 0,
        paymentsProcessed: 0,
        customersImported: 0,
        contactsImported: 0,
        invoicesImported: 0,
        paymentsImported: 0,
        importErrors: 0,
    };
}
async function finalizeLegacyCustomerBalances(customerIds, prisma, onCustomerBalancesFinal, log, setStep) {
    if (customerIds.size === 0) {
        return;
    }
    const ids = Array.from(customerIds);
    const total = ids.length;
    const run = onCustomerBalancesFinal ??
        ((customerIdsToRecalc, options) => (0, recalculateCustomerAmountsHost_1.recalculateCustomerAmountsViaHost)(customerIdsToRecalc, prisma, options));
    setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
        status: "running",
        processed: 0,
        total,
        detail: {
            step: "balances",
            processed: 0,
            total,
        },
    });
    log(`Recalculate balances starting for ${total} customer(s)…`);
    try {
        await run(ids, {
            onProgress: ({ processed, total: progressTotal }) => {
                setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
                    status: "running",
                    processed,
                    total: progressTotal,
                    detail: {
                        step: "balances",
                        processed,
                        total: progressTotal,
                    },
                });
                log(`Recalculate balances progress: ${processed}/${progressTotal} customer(s)`);
            },
        });
        log(`Recalculated customer due/overdue amounts for ${total} customer(s)`);
        setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
            status: "done",
            processed: total,
            total,
            detail: {
                step: "balances",
                processed: total,
                total,
            },
        });
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Customer amount recalculation failed";
        log(`Customer amount recalculation failed: ${message}`);
        setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
            status: "failed",
            total,
            error: message,
        });
    }
}
function emitProgress(onProgress, stats, activeStep, activeStepDetail) {
    onProgress?.({
        entity_stats: (0, connectorSyncRuntime_1.entityStatsFromCounts)(stats),
        active_step: activeStep ?? null,
        active_step_detail: activeStepDetail ?? null,
    });
}
function entityStatsFrom(stats) {
    return (0, connectorSyncRuntime_1.entityStatsFromCounts)(stats);
}
function attachSyncMeta(result, options) {
    const cancelled = isCancelRequested(options) || Boolean(result.cancelled);
    return {
        ...result,
        cancelled,
        entity_stats: result.entity_stats ?? entityStatsFrom(result.stats),
    };
}
function isCancelRequested(options) {
    return Boolean(options.executionId &&
        (0, connectorSyncCancelRegistry_1.isConnectorSyncCancelRequested)(options.executionId));
}
function normalizeExtensionConfig(value) {
    if (value == null)
        return null;
    if (typeof value !== "object" || Array.isArray(value))
        return null;
    return { ...value };
}
function enabledEntitiesFromConnector(raw) {
    if (!Array.isArray(raw)) {
        return [...stagedExtensionSync_1.STAGED_ENTITY_ORDER];
    }
    return raw.filter((e) => typeof e === "string" &&
        stagedExtensionSync_1.STAGED_ENTITY_ORDER.includes(e));
}
/**
 * In-process Priority sync for main API / worker (D71).
 * Accounts with extension_key use staged windowed plugin path;
 * accounts without a key keep entity-by-entity pull/map/import.
 */
function resolveInitialSyncMode(options) {
    if (options.mode === "incremental")
        return "INCREMENTAL";
    if (options.mode === "backfill")
        return "BACKFILL";
    return "UNKNOWN";
}
async function runInProcessSync(options) {
    const obsRuntime = {
        connectorId: null,
        provider: "UNKNOWN",
        syncMode: resolveInitialSyncMode(options),
        startedAtMs: Date.now(),
        startEmitted: false,
    };
    const result = attachSyncMeta(await runInProcessSyncBody(options, obsRuntime), options);
    const structuredLogs = options.observability?.structuredLogs !== false;
    const metrics = options.observability?.metrics ??
        (0, observability_1.getDefaultBillingConnectorMetricsSink)();
    // Skip dry-run / preview noise on Prometheus (still allow Loki if host wants).
    const emitMetrics = metrics && !options.dryRun ? metrics : null;
    (0, observability_1.emitBillingConnectorSyncFinish)({
        accountId: options.accountId,
        connectorId: obsRuntime.connectorId,
        provider: result.provider || obsRuntime.provider,
        syncMode: obsRuntime.syncMode,
        trigger: options.trigger ?? "manual",
        executionId: options.executionId,
        correlationId: options.observability?.correlationId,
        startedAtMs: obsRuntime.startedAtMs,
        result,
    }, {
        onLog: options.onLog,
        metrics: emitMetrics,
        structuredLogs,
    });
    return result;
}
async function runInProcessSyncBody(options, obsRuntime) {
    const { prisma, accountId, trigger = "manual", userId, dryRun = false, onLog, } = options;
    const stats = emptyStats();
    let activeStep = null;
    let activeStepDetail = null;
    const emit = () => emitProgress(options.onProgress, stats, activeStep, activeStepDetail);
    const resolveExtension = options.resolveExtension ?? extensions_1.getRegisteredExtension;
    const importBatch = options.importBatch ?? entityImporter_1.importMappedEntityBatch;
    const log = (message) => emitSyncLog(onLog, message);
    const structuredLogs = options.observability?.structuredLogs !== false;
    const setTailStep = (key, state) => {
        // A late `running` update must not resurrect a finished step.
        const current = stats.tailSteps?.[key];
        if (state.status === "running" &&
            (current?.status === "done" ||
                current?.status === "failed" ||
                current?.status === "queued")) {
            return;
        }
        stats.tailSteps = { ...(stats.tailSteps ?? {}), [key]: state };
        if (state.status === "running") {
            activeStep = key;
            activeStepDetail = state.detail?.step ?? null;
        }
        else if ((state.status === "done" || state.status === "failed") &&
            activeStep === key) {
            // Clear so the UI does not keep the finished step as Running.
            activeStep = null;
            activeStepDetail = null;
        }
        emit();
    };
    /** Inline Process Overdue → AR replay → insurance refresh for the progress panel. */
    const runArTailWithProgress = async (args) => {
        // Nest wires onProcessOverdueCustomers as its own step; skip overdue inside
        // runInlineArPostIngestTailSteps (separateOverdueStep) and run it here first.
        if (options.onProcessOverdueCustomers &&
            args.customerIds.length > 0) {
            await (0, processOverdueTailStep_1.runProcessOverdueTailStep)({
                customerIds: args.customerIds,
                onProcessOverdueCustomers: options.onProcessOverdueCustomers,
                log,
                setTailStep: (state) => setTailStep(connectorSyncRuntime_1.PROCESS_OVERDUE_ENTITY_STATS_KEY, state),
            });
        }
        await (0, arPostIngestTailSteps_1.runInlineArPostIngestTailSteps)({
            accountId,
            customerIds: args.customerIds,
            invoiceEntityIds: args.invoiceEntityIds,
            paymentEntityIds: args.paymentEntityIds,
            mepBreachStartDate: args.mepBreachStartDate,
            prisma,
            onArPostIngest: options.onArPostIngest,
            log,
            setTailStep,
            separateOverdueStep: Boolean(options.onProcessOverdueCustomers),
            onProcessOverdueCustomers: options.onProcessOverdueCustomers,
            runMaturity: args.runMaturity,
            importType: args.invoiceEntityIds.length > 0 ? "Invoice" : "Payment",
        });
    };
    try {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            log("No billing connector configured for this account");
            return {
                ok: false,
                accountId,
                provider: "UNKNOWN",
                stats,
                message: "No billing connector configured for this account",
                error: "CONNECTOR_NOT_FOUND",
            };
        }
        obsRuntime.connectorId = connector.id;
        obsRuntime.provider = connector.provider;
        if (obsRuntime.syncMode === "UNKNOWN") {
            obsRuntime.syncMode = connector.sync_mode;
        }
        if (!obsRuntime.startEmitted) {
            obsRuntime.startEmitted = true;
            (0, observability_1.emitBillingConnectorSyncStart)({
                accountId,
                connectorId: connector.id,
                provider: connector.provider,
                syncMode: obsRuntime.syncMode,
                trigger,
                executionId: options.executionId,
                correlationId: options.observability?.correlationId,
            }, onLog, structuredLogs);
        }
        const extensionKey = typeof connector.extension_key === "string"
            ? connector.extension_key.trim() || null
            : null;
        const skipReportingBreach = (0, entityImporter_1.shouldSkipReportingBreachOnConnectorWrite)({
            syncMode: options.mode === "incremental" ? "INCREMENTAL" : "BACKFILL",
            skipReportingBreachOnBackfill: connector.skip_reporting_breach_on_backfill === true,
        });
        const enabled = enabledEntitiesFromConnector(connector.enabled_entities);
        log(`Starting ${options.mode ?? trigger}${dryRun ? " preview" : ""} for account ${accountId} (${enabled.join(", ")}${extensionKey ? `; extension ${extensionKey}` : ""})`);
        const clearRequested = !dryRun &&
            options.mode === "backfill" &&
            Array.isArray(options.clearBeforeImport) &&
            options.clearBeforeImport.length > 0
            ? options.clearBeforeImport
            : [];
        const scopedCustomerId = !dryRun && options.mode === "backfill"
            ? (0, clearBeforeImport_1.parseCustomerIdForClearBeforeImport)(options.customerId)
            : null;
        let runtimeCustomerNumber = null;
        let clearCustomerId = null;
        if (scopedCustomerId != null) {
            const customer = await (0, clearBeforeImport_1.resolveAccountCustomerById)({
                prisma,
                accountId,
                customerId: scopedCustomerId,
            });
            if (!customer) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: `Customer not found: id ${scopedCustomerId}`,
                    error: "CUSTOMER_NOT_FOUND",
                };
            }
            clearCustomerId = customer.id;
            // Post-map pull filter uses Archaser customer_number for this id.
            runtimeCustomerNumber = customer.customer_number;
            log(`Customer scope for this Start: id=${customer.id} number=${customer.customer_number}`);
        }
        if (clearRequested.length > 0) {
            log(`Clear before import: ${clearRequested.join(", ")} (enabled ∩ requested)`);
            const applyDeletedCounts = (deleted) => {
                if (deleted.Customer != null) {
                    stats.customersDeleted = deleted.Customer;
                }
                if (deleted.Contact != null) {
                    stats.contactsDeleted = deleted.Contact;
                }
                if (deleted.Invoice != null) {
                    stats.invoicesDeleted = deleted.Invoice;
                }
                if (deleted.Payment != null) {
                    stats.paymentsDeleted = deleted.Payment;
                }
            };
            stats.purgeStatus = "running";
            stats.purgeDetail = { step: "deleting", processed: 0 };
            activeStep = connectorSyncRuntime_1.PURGE_ENTITY_STATS_KEY;
            activeStepDetail = "deleting";
            emit();
            let purgeResult;
            try {
                purgeResult = await (0, clearBeforeImport_1.clearBeforeImport)({
                    prisma,
                    accountId,
                    entities: clearRequested,
                    enabledEntities: enabled,
                    customerId: clearCustomerId,
                    shouldCancel: () => isCancelRequested(options),
                    onProgress: (progress) => {
                        applyDeletedCounts(progress.deleted);
                        if (progress.total != null) {
                            stats.purgeTotal = progress.total;
                        }
                        const deletedSoFar = (stats.customersDeleted ?? 0) +
                            (stats.contactsDeleted ?? 0) +
                            (stats.invoicesDeleted ?? 0) +
                            (stats.paymentsDeleted ?? 0);
                        stats.purgeStatus = "running";
                        stats.purgeDetail = {
                            step: progress.currentEntity
                                ? `deleting_${progress.currentEntity.toLowerCase()}`
                                : "deleting",
                            processed: deletedSoFar,
                            total: stats.purgeTotal,
                        };
                        activeStepDetail = stats.purgeDetail.step;
                        emit();
                    },
                });
            }
            catch (err) {
                const message = err instanceof Error
                    ? err.message
                    : "Clear before import failed";
                log(`Clear before import failed: ${message}`);
                stats.purgeStatus = "cancelled";
                emit();
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message,
                    error: "CLEAR_BEFORE_IMPORT_FAILED",
                };
            }
            applyDeletedCounts(purgeResult.deleted);
            if (purgeResult.deleted.Customer != null) {
                log(`Cleared ${purgeResult.deleted.Customer} Customer row(s)`);
            }
            if (purgeResult.deleted.Contact != null) {
                log(`Cleared ${purgeResult.deleted.Contact} Contact row(s)`);
            }
            if (purgeResult.deleted.Invoice != null) {
                log(`Cleared ${purgeResult.deleted.Invoice} Invoice row(s)`);
            }
            if (purgeResult.deleted.Payment != null) {
                log(`Cleared ${purgeResult.deleted.Payment} InvoicePayment row(s)`);
            }
            if (purgeResult.cancelled) {
                stats.purgeStatus = "cancelled";
                emit();
                log("Stopped by operator during clear before import");
                return {
                    ok: true,
                    cancelled: true,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Stopped by operator during clear before import",
                };
            }
            stats.purgeStatus = "done";
            stats.purgeDetail = { step: "deleting" };
            activeStep = enabled[0] ?? null;
            activeStepDetail = "sampling";
            emit();
        }
        // Fail fast at sync start — never silently fall back to legacy path.
        let extension;
        if (extensionKey) {
            extension = resolveExtension(extensionKey);
            if (!extension) {
                log(`Unknown extension_key: ${extensionKey}`);
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    extension_key: extensionKey,
                    dry_run: dryRun,
                    message: `Unknown extension_key: ${extensionKey}`,
                    error: `Unknown extension_key: ${extensionKey}`,
                };
            }
        }
        try {
            (0, provider_1.assertPriorityProvider)(connector.provider);
        }
        catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                stats,
                message: `Provider ${connector.provider} is not supported`,
                error: err instanceof Error ? err.message : "UNSUPPORTED_PROVIDER",
            };
        }
        if (!options.provider) {
            if (!connector.credentials_encrypted || !connector.base_url) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Missing base_url or credentials",
                    error: "MISSING_CREDENTIALS",
                };
            }
        }
        let credentials = {};
        if (!options.provider) {
            try {
                credentials = (0, billingConnectorCrypto_1.decryptCredentials)(connector.credentials_encrypted);
            }
            catch (err) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Failed to decrypt credentials",
                    error: err instanceof Error
                        ? err.message
                        : "DECRYPTION_FAILED",
                };
            }
        }
        if (!options.skipConnectionTest && !options.provider) {
            log("Testing ERP connection…");
            const connectionResult = await (0, PriorityClient_1.testPriorityConnection)({
                baseUrl: connector.base_url,
                authType: connector.auth_type,
                credentials,
            });
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: {
                    last_connection_test_at: connectionResult.testedAt,
                    last_connection_error: connectionResult.ok
                        ? null
                        : connectionResult.error ?? null,
                    modified_at: new Date(),
                },
            });
            if (!connectionResult.ok) {
                log(`Connection test failed: ${connectionResult.error ?? "unknown error"}`);
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Connection test failed",
                    error: connectionResult.error,
                };
            }
            log("Connection test passed");
        }
        const client = options.provider ??
            new PriorityProviderClient_1.PriorityProviderClient({
                baseUrl: connector.base_url,
                authType: connector.auth_type,
                credentials,
                onLog,
            });
        const mappings = await prisma.connectorFieldMapping.findMany({
            where: { connector_id: connector.id },
        });
        const mappingByType = new Map(mappings.map((m) => [String(m.import_type), m]));
        const mappingRulesByType = new Map(mappings.map((m) => [
            String(m.import_type),
            (0, connectorFieldUtils_1.parseMappingRules)(m.mapping),
        ]));
        const entitySets = (0, billingConnectorEntitySets_1.parseEntitySetsMap)(connector.entity_sets);
        const dateFieldByType = new Map(mappings.map((row) => {
            const value = "pull_date_field" in row
                ? row
                    .pull_date_field
                : null;
            const trimmed = typeof value === "string" ? value.trim() : "";
            return [String(row.import_type), trimmed || null];
        }));
        // -------- Staged extension path --------
        if (extensionKey && extension) {
            const isIncremental = options.mode === "incremental";
            let windows = options.windows;
            if (!windows) {
                if (isIncremental) {
                    let earliest = null;
                    for (const entityType of enabled) {
                        const syncState = await prisma.connectorSyncState.findFirst({
                            where: {
                                connector_id: connector.id,
                                entity_type: entityType,
                            },
                        });
                        const watermark = syncState?.last_max_updated_at ?? null;
                        if (watermark &&
                            (!earliest || watermark < earliest)) {
                            earliest = watermark;
                        }
                    }
                    windows = (0, stagedExtensionSync_1.planDefaultSyncWindows)({
                        earliestWatermark: earliest,
                    });
                }
                else {
                    windows = (0, stagedExtensionSync_1.planDefaultSyncWindows)({
                        earliestWatermark: connector.backfill_start_date ?? null,
                    });
                }
            }
            const staged = await (0, stagedExtensionSync_1.runStagedExtensionSync)({
                prisma,
                accountId,
                connectorId: connector.id,
                extension,
                extensionConfig: normalizeExtensionConfig(connector.extension_config),
                provider: client,
                mappingByType: mappingRulesByType,
                enabledEntities: enabled,
                windows,
                dryRun,
                userId,
                skipReportingBreach,
                importBatch,
                onLog,
                onProgress: (liveStats, meta) => {
                    if (stats.customersDeleted != null) {
                        liveStats.customersDeleted = stats.customersDeleted;
                    }
                    if (stats.contactsDeleted != null) {
                        liveStats.contactsDeleted = stats.contactsDeleted;
                    }
                    if (stats.invoicesDeleted != null) {
                        liveStats.invoicesDeleted = stats.invoicesDeleted;
                    }
                    if (stats.paymentsDeleted != null) {
                        liveStats.paymentsDeleted = stats.paymentsDeleted;
                    }
                    if (stats.purgeTotal != null) {
                        liveStats.purgeTotal = stats.purgeTotal;
                    }
                    if (stats.purgeStatus) {
                        liveStats.purgeStatus = stats.purgeStatus;
                        if (stats.purgeDetail) {
                            liveStats.purgeDetail = stats.purgeDetail;
                        }
                    }
                    emitProgress(options.onProgress, liveStats, meta?.activeStep, meta?.activeStepDetail);
                },
                shouldCancel: () => isCancelRequested(options),
                onCustomerBalancesFinal: options.onCustomerBalancesFinal,
                onArPostIngest: options.onArPostIngest,
                onProcessOverdueCustomers: options.onProcessOverdueCustomers,
                deferPostIngest: options.deferPostIngest,
                enqueueDeferredSteps: options.enqueueDeferredSteps,
                schedulePostIngestDrain: options.schedulePostIngestDrain,
                mepBreachStartDate: options.mepBreachStartDate ??
                    connector.mep_breach_start_date,
                pullCreatedOnOrAfter: !isIncremental && Boolean(connector.backfill_start_date),
                pullFilters: connector.pull_filters,
                runtimeCustomerNumber,
                entitySets: connector.entity_sets,
                dateFieldByType,
                overlapMinutes: connector.sync_overlap_minutes,
            });
            const imported = staged.stats.customersImported +
                staged.stats.contactsImported +
                staged.stats.invoicesImported +
                staged.stats.paymentsImported;
            const finishMessage = staged.cancelled
                ? `Stopped by operator after importing ${imported} row(s)`
                : dryRun
                    ? `Preview via ${trigger} (extension ${extensionKey}): processed without writes`
                    : `Synced via ${trigger} (extension ${extensionKey}): imported ${imported} rows (${staged.stats.importErrors} errors)`;
            log(staged.ok
                ? finishMessage
                : `Sync failed: ${staged.error ?? finishMessage}`);
            // Preserve clear-before-import deleted counts (staged starts empty).
            const mergedStats = {
                ...staged.stats,
                ...(stats.customersDeleted != null
                    ? { customersDeleted: stats.customersDeleted }
                    : {}),
                ...(stats.contactsDeleted != null
                    ? { contactsDeleted: stats.contactsDeleted }
                    : {}),
                ...(stats.invoicesDeleted != null
                    ? { invoicesDeleted: stats.invoicesDeleted }
                    : {}),
                ...(stats.paymentsDeleted != null
                    ? { paymentsDeleted: stats.paymentsDeleted }
                    : {}),
                ...(stats.purgeTotal != null
                    ? { purgeTotal: stats.purgeTotal }
                    : {}),
                ...(stats.purgeStatus
                    ? {
                        purgeStatus: stats.purgeStatus,
                        ...(stats.purgeDetail
                            ? { purgeDetail: stats.purgeDetail }
                            : {}),
                    }
                    : {}),
            };
            return {
                ok: staged.ok,
                cancelled: staged.cancelled,
                postIngestDeferred: staged.postIngestDeferred,
                accountId,
                provider: connector.provider,
                stats: mergedStats,
                extension_key: extensionKey,
                dry_run: dryRun,
                preview_batch: staged.previewBatch,
                window_outcomes: staged.windows.map((w) => ({
                    start: w.window.start,
                    end: w.window.end,
                    ok: w.ok,
                    error: w.error,
                    imported: w.imported,
                })),
                message: finishMessage,
                error: staged.error,
            };
        }
        // -------- Legacy entity-by-entity path (no extension_key) --------
        if (dryRun) {
            // Preview without extension: pull+map only, no writes.
            for (const entityType of ENTITY_ORDER) {
                if (!enabled.includes(entityType))
                    continue;
                const mapping = mappingByType.get(entityType);
                if (!mapping)
                    continue;
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });
                const usesDatePull = entityType === "Invoice" || entityType === "Payment";
                const pullResult = await client.pull(entityType, {
                    since: usesDatePull
                        ? syncState?.last_max_updated_at ?? null
                        : null,
                    preferredDateField: usesDatePull
                        ? dateFieldByType.get(entityType) ?? null
                        : null,
                    overlapMinutes: connector.sync_overlap_minutes,
                    pageSize: priorityApiContract_1.PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet: entitySets[entityType] ?? null,
                    filter: (0, billingConnectorPullFilters_1.resolveImportPullFilterOData)(connector.pull_filters, entityType, {
                        runtimeCustomerNumber,
                        entitySet: entitySets[entityType] ?? null,
                    }),
                    select: (0, prioritySelectFields_1.odataSelectFieldsFromMapping)({
                        mappingRules: mappingRulesByType.get(entityType) ?? [],
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });
                const processedKey = `${entityType.toLowerCase()}sProcessed`;
                stats[processedKey] =
                    pullResult.records.length;
            }
            return {
                ok: true,
                accountId,
                provider: connector.provider,
                stats,
                extension_key: null,
                dry_run: true,
                message: `Preview via ${trigger}: no extension (legacy path, no writes)`,
            };
        }
        log("Using standard entity-by-entity path (no extension)");
        const arAffectedCustomerIds = new Set();
        const arAffectedInvoiceIds = new Set();
        const arAffectedPaymentIds = new Set();
        const paymentAffectedCustomerIds = new Set();
        let invoicePostIngestRan = false;
        for (const entityType of ENTITY_ORDER) {
            if (isCancelRequested(options)) {
                log("Stopped by operator");
                await finalizeLegacyCustomerBalances(arAffectedCustomerIds, prisma, options.onCustomerBalancesFinal, log);
                return {
                    ok: true,
                    cancelled: true,
                    accountId,
                    provider: connector.provider,
                    stats,
                    extension_key: null,
                    dry_run: false,
                    message: "Stopped by operator",
                };
            }
            if (!enabled.includes(entityType))
                continue;
            const mapping = mappingByType.get(entityType);
            if (!mapping)
                continue;
            activeStep = entityType;
            activeStepDetail = "pulling";
            try {
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });
                const usesDatePull = entityType === "Invoice" || entityType === "Payment";
                const pullResult = await client.pull(entityType, {
                    since: usesDatePull
                        ? syncState?.last_max_updated_at ?? null
                        : null,
                    preferredDateField: usesDatePull
                        ? dateFieldByType.get(entityType) ?? null
                        : null,
                    overlapMinutes: connector.sync_overlap_minutes,
                    pageSize: priorityApiContract_1.PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet: entitySets[entityType] ?? null,
                    filter: (0, billingConnectorPullFilters_1.resolveImportPullFilterOData)(connector.pull_filters, entityType, {
                        runtimeCustomerNumber,
                        entitySet: entitySets[entityType] ?? null,
                    }),
                    select: (0, prioritySelectFields_1.odataSelectFieldsFromMapping)({
                        mappingRules: mappingRulesByType.get(entityType) ?? [],
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });
                const processedKey = `${entityType.toLowerCase()}sProcessed`;
                const importedKey = `${entityType.toLowerCase()}sImported`;
                stats[processedKey] =
                    pullResult.records.length;
                emit();
                activeStepDetail = "importing";
                const importResult = await importBatch(prisma, entityType, pullResult.records, accountId, mapping.mapping, userId, { skipReportingBreach, onLog, shouldCancel: () => isCancelRequested(options) });
                stats[importedKey] =
                    importResult.success;
                stats.importErrors += importResult.failed;
                if (entityType === "Payment" || entityType === "Invoice") {
                    for (const id of importResult.affectedCustomerIds) {
                        arAffectedCustomerIds.add(id);
                        if (entityType === "Payment") {
                            paymentAffectedCustomerIds.add(id);
                        }
                    }
                    for (const id of importResult.entityIds ?? []) {
                        if (entityType === "Invoice") {
                            arAffectedInvoiceIds.add(id);
                        }
                        else {
                            arAffectedPaymentIds.add(id);
                        }
                    }
                }
                emit();
                if (entityType === "Invoice") {
                    invoicePostIngestRan = true;
                    await runArTailWithProgress({
                        customerIds: Array.from(arAffectedCustomerIds),
                        invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                        paymentEntityIds: Array.from(arAffectedPaymentIds),
                        runMaturity: false,
                        mepBreachStartDate: options.mepBreachStartDate ??
                            connector.mep_breach_start_date,
                    });
                }
                const maxUpdated = (0, entityImporter_1.extractMaxUpdatedAt)(pullResult.records) ?? new Date();
                await prisma.connectorSyncState.upsert({
                    where: {
                        connector_id_entity_type: {
                            connector_id: connector.id,
                            entity_type: entityType,
                        },
                    },
                    create: {
                        connector_id: connector.id,
                        entity_type: entityType,
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        backfill_records_pulled: pullResult.records.length,
                        last_error: importResult.failed > 0
                            ? importResult.errors.slice(0, 3).join("; ")
                            : null,
                    },
                    update: {
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        backfill_records_pulled: pullResult.records.length,
                        last_error: importResult.failed > 0
                            ? importResult.errors.slice(0, 3).join("; ")
                            : null,
                    },
                });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
                log(`${entityType} sync failed: ${message}`);
                stats.importErrors += 1;
                await prisma.connectorSyncState.upsert({
                    where: {
                        connector_id_entity_type: {
                            connector_id: connector.id,
                            entity_type: entityType,
                        },
                    },
                    create: {
                        connector_id: connector.id,
                        entity_type: entityType,
                        last_error: `${entityType} sync failed: ${message}`,
                        last_attempt_at: new Date(),
                    },
                    update: {
                        last_error: `${entityType} sync failed: ${message}`,
                        last_attempt_at: new Date(),
                    },
                });
            }
        }
        if (!invoicePostIngestRan &&
            paymentAffectedCustomerIds.size > 0) {
            await runArTailWithProgress({
                customerIds: Array.from(paymentAffectedCustomerIds),
                invoiceEntityIds: [],
                paymentEntityIds: Array.from(arAffectedPaymentIds),
                runMaturity: true,
                mepBreachStartDate: options.mepBreachStartDate ??
                    connector.mep_breach_start_date,
            });
        }
        await finalizeLegacyCustomerBalances(arAffectedCustomerIds, prisma, options.onCustomerBalancesFinal, log, setTailStep);
        const imported = stats.customersImported +
            stats.contactsImported +
            stats.invoicesImported +
            stats.paymentsImported;
        log(`Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`);
        return {
            ok: stats.importErrors === 0,
            postIngestDeferred: false,
            accountId,
            provider: connector.provider,
            stats,
            extension_key: null,
            dry_run: false,
            message: `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`,
            error: stats.importErrors > 0
                ? `${stats.importErrors} import error(s)`
                : undefined,
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        log(`Sync failed with unexpected error: ${message}`);
        return {
            ok: false,
            accountId,
            provider: "UNKNOWN",
            stats,
            message: "Sync failed with unexpected error",
            error: message,
        };
    }
}
