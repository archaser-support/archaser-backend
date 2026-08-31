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
const connectorSyncCancelRegistry_1 = require("./connectorSyncCancelRegistry");
const connectorSyncRuntime_1 = require("./connectorSyncRuntime");
const stagedExtensionSync_1 = require("./stagedExtensionSync");
const recalculateCustomerAmountsHost_1 = require("../customers/recalculateCustomerAmountsHost");
const arPostIngestHost_1 = require("../credit/arPostIngestHost");
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
    const run = onCustomerBalancesFinal ??
        ((customerIdsToRecalc) => (0, recalculateCustomerAmountsHost_1.recalculateCustomerAmountsViaHost)(customerIdsToRecalc, prisma));
    setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
        status: "running",
        total: ids.length,
    });
    try {
        await run(ids);
        log(`Recalculated customer due/overdue amounts for ${ids.length} customer(s)`);
        setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
            status: "done",
            processed: ids.length,
            total: ids.length,
        });
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Customer amount recalculation failed";
        log(`Customer amount recalculation failed: ${message}`);
        setStep?.(connectorSyncRuntime_1.BALANCES_ENTITY_STATS_KEY, {
            status: "failed",
            total: ids.length,
            error: message,
        });
    }
}
function emitProgress(onProgress, stats) {
    onProgress?.((0, connectorSyncRuntime_1.entityStatsFromCounts)(stats));
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
        emitProgress(options.onProgress, stats);
    };
    /** Wraps post-ingest so the UI shows it instead of freezing on the last entity. */
    const runPostIngestWithProgress = async (args) => {
        setTailStep(connectorSyncRuntime_1.POST_INGEST_ENTITY_STATS_KEY, {
            status: "running",
            total: args.customerIds.length,
        });
        try {
            const postIngest = await (0, arPostIngestHost_1.invokeConnectorArPostIngest)({
                accountId,
                customerIds: args.customerIds,
                invoiceEntityIds: args.invoiceEntityIds,
                paymentEntityIds: args.paymentEntityIds,
                prisma,
                onArPostIngest: options.onArPostIngest,
                log,
                runMaturity: args.runMaturity,
                deferPostIngest: options.deferPostIngest,
                enqueueDeferredSteps: options.enqueueDeferredSteps,
                schedulePostIngestDrain: options.schedulePostIngestDrain,
                onProgress: ({ completed, total, step, detail }) => {
                    setTailStep(connectorSyncRuntime_1.POST_INGEST_ENTITY_STATS_KEY, {
                        status: "running",
                        processed: completed,
                        total,
                        ...(step
                            ? { detail: { step, ...(detail ?? {}) } }
                            : {}),
                    });
                },
            });
            setTailStep(connectorSyncRuntime_1.POST_INGEST_ENTITY_STATS_KEY, {
                status: postIngest.deferred ? "queued" : "done",
                processed: args.customerIds.length,
                total: args.customerIds.length,
            });
        }
        catch (error) {
            setTailStep(connectorSyncRuntime_1.POST_INGEST_ENTITY_STATS_KEY, {
                status: "failed",
                total: args.customerIds.length,
                error: error instanceof Error
                    ? error.message
                    : "AR post-ingest failed",
            });
        }
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
                onProgress: (liveStats) => emitProgress(options.onProgress, liveStats),
                shouldCancel: () => isCancelRequested(options),
                onCustomerBalancesFinal: options.onCustomerBalancesFinal,
                onArPostIngest: options.onArPostIngest,
                deferPostIngest: options.deferPostIngest,
                enqueueDeferredSteps: options.enqueueDeferredSteps,
                schedulePostIngestDrain: options.schedulePostIngestDrain,
                pullCreatedOnOrAfter: !isIncremental && Boolean(connector.backfill_start_date),
                pullFilters: connector.pull_filters,
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
            return {
                ok: staged.ok,
                cancelled: staged.cancelled,
                accountId,
                provider: connector.provider,
                stats: staged.stats,
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
                    filter: (0, billingConnectorPullFilters_1.resolveImportPullFilterOData)(connector.pull_filters, entityType),
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
                    filter: (0, billingConnectorPullFilters_1.resolveImportPullFilterOData)(connector.pull_filters, entityType),
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
                emitProgress(options.onProgress, stats);
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
                emitProgress(options.onProgress, stats);
                if (entityType === "Invoice") {
                    invoicePostIngestRan = true;
                    await runPostIngestWithProgress({
                        customerIds: Array.from(arAffectedCustomerIds),
                        invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                        paymentEntityIds: Array.from(arAffectedPaymentIds),
                        runMaturity: false,
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
            await runPostIngestWithProgress({
                customerIds: Array.from(paymentAffectedCustomerIds),
                invoiceEntityIds: [],
                paymentEntityIds: Array.from(arAffectedPaymentIds),
                runMaturity: true,
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
