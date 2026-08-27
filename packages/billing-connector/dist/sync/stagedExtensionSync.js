"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGED_ENTITY_ORDER = void 0;
exports.runStagedExtensionSync = runStagedExtensionSync;
exports.planDefaultSyncWindows = planDefaultSyncWindows;
const entityImporter_1 = require("../import/entityImporter");
const applyMaturedDeferredPayments_1 = require("../import/applyMaturedDeferredPayments");
const recalculateCustomerAmountsHost_1 = require("../customers/recalculateCustomerAmountsHost");
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
const priorityApiContract_1 = require("../priority/priorityApiContract");
const prioritySelectFields_1 = require("../priority/prioritySelectFields");
const billingConnectorEntitySets_1 = require("../services/billingConnectorEntitySets");
const billingConnectorPullFilters_1 = require("../services/billingConnectorPullFilters");
exports.STAGED_ENTITY_ORDER = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];
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
function emptyPaymentLinkProgress() {
    return {
        paymentLinkStatus: undefined,
        paymentsLinked: 0,
        paymentsStillDeferred: 0,
        paymentsLinkTotal: 0,
        paymentLinkError: undefined,
    };
}
function recordInWindow(record, window) {
    const raw = record.UDATE ?? record.udate ?? record.updated_at;
    if (!raw) {
        // No timestamp — include when window is open-ended on the high side.
        return window.end == null;
    }
    const ts = new Date(String(raw));
    if (Number.isNaN(ts.getTime())) {
        return window.end == null;
    }
    if (window.start && ts < window.start) {
        return false;
    }
    if (window.end && ts >= window.end) {
        return false;
    }
    return true;
}
function mergeBatch(target, source) {
    for (const entityType of exports.STAGED_ENTITY_ORDER) {
        const rows = source[entityType];
        if (!rows || rows.length === 0)
            continue;
        target[entityType] = [...(target[entityType] ?? []), ...rows];
    }
}
function bumpProcessedPage(stats, entityType, count) {
    stats[processedKey(entityType)] =
        (stats[processedKey(entityType)] ?? 0) +
            count;
}
function processedKey(entityType) {
    return `${entityType.toLowerCase()}sProcessed`;
}
/** ConnectorSyncState.backfill_cursor and last_error are varchar(500). */
const SYNC_STATE_TEXT_LIMIT = 500;
function clipSyncStateText(value) {
    if (value == null || value === "") {
        return null;
    }
    if (value.length <= SYNC_STATE_TEXT_LIMIT) {
        return value;
    }
    return value.slice(0, SYNC_STATE_TEXT_LIMIT);
}
async function checkpointEntityPage(params) {
    const now = new Date();
    const nextCursor = clipSyncStateText(params.nextCursor);
    const lastError = clipSyncStateText(params.lastError);
    await params.prisma.connectorSyncState.upsert({
        where: {
            connector_id_entity_type: {
                connector_id: params.connectorId,
                entity_type: params.entityType,
            },
        },
        create: {
            connector_id: params.connectorId,
            entity_type: params.entityType,
            backfill_records_pulled: params.pulled,
            backfill_cursor: nextCursor,
            backfill_completed: params.pageComplete && nextCursor == null,
            backfill_last_checkpoint_at: now,
            last_attempt_at: now,
            last_successful_run_at: now,
            last_max_updated_at: params.maxUpdated ?? undefined,
            last_error: lastError,
        },
        update: {
            backfill_records_pulled: params.pulled,
            backfill_cursor: nextCursor,
            backfill_completed: params.pageComplete && nextCursor == null,
            backfill_last_checkpoint_at: now,
            last_attempt_at: now,
            last_successful_run_at: now,
            last_max_updated_at: params.maxUpdated ?? undefined,
            last_error: lastError,
        },
    });
}
function bumpImported(stats, entityType, success, failed) {
    const key = `${entityType.toLowerCase()}sImported`;
    stats[key] =
        (stats[key] ?? 0) + success;
    stats.importErrors += failed;
}
async function finalizeCustomerBalances(customerIds, prisma, onCustomerBalancesFinal, log) {
    if (customerIds.size === 0) {
        return;
    }
    const ids = Array.from(customerIds);
    const run = onCustomerBalancesFinal ??
        ((customerIdsToRecalc) => (0, recalculateCustomerAmountsHost_1.recalculateCustomerAmountsViaHost)(customerIdsToRecalc, prisma));
    try {
        await run(ids);
        log(`Recalculated customer due/overdue amounts for ${ids.length} customer(s)`);
    }
    catch (error) {
        const message = error instanceof Error
            ? error.message
            : "Customer amount recalculation failed";
        log(`Customer amount recalculation failed: ${message}`);
    }
}
/**
 * Staged path: for each window and entity, pull one page, run the extension
 * plugin on that page, then upsert immediately. Row-level import failures are
 * counted and checkpointed (`last_error`) but do not abort remaining pages,
 * entities, or windows. Never falls back to importing pre-plugin rows.
 */
async function runStagedExtensionSync(options) {
    const stats = emptyStats();
    const paymentLink = emptyPaymentLinkProgress();
    const windows = [];
    const previewBatch = {};
    const importFn = options.importBatch ?? entityImporter_1.importMappedEntityBatch;
    const dryRun = options.dryRun === true;
    const log = (message) => options.onLog?.(message);
    const emitProgress = () => options.onProgress?.({
        ...stats,
        ...paymentLink,
    });
    const resultStats = () => ({
        ...stats,
        ...paymentLink,
    });
    const cutover = options.pullCreatedOnOrAfter === true;
    const entitySets = (0, billingConnectorEntitySets_1.parseEntitySetsMap)(options.entitySets);
    const arAffectedCustomerIds = new Set();
    const finishWithBalances = async (result) => {
        if (!dryRun) {
            await finalizeCustomerBalances(arAffectedCustomerIds, options.prisma, options.onCustomerBalancesFinal, log);
        }
        return result;
    };
    for (const window of options.windows) {
        log(window.start || window.end
            ? `Window ${window.start?.toISOString() ?? "start"} → ${window.end?.toISOString() ?? "now"}`
            : "Pulling full-history window");
        const windowBatch = {};
        let windowImported = 0;
        let windowErrors = 0;
        const windowCutover = cutover && window.start ? window.start : null;
        for (const entityType of exports.STAGED_ENTITY_ORDER) {
            if (!options.enabledEntities.includes(entityType)) {
                continue;
            }
            const rules = options.mappingByType.get(entityType);
            if (!rules || rules.length === 0) {
                log(`Skipping ${entityType}: no field mapping configured`);
                continue;
            }
            let afterKey = null;
            if (!dryRun) {
                const syncState = await options.prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: options.connectorId,
                        entity_type: entityType,
                    },
                });
                afterKey = syncState?.backfill_cursor ?? null;
                // Clear completion before sampling/pull so the UI stays on
                // Running until every page for this entity is fetched. Otherwise
                // a prior-run backfill_completed + first live page looks "Done".
                // Also zero pulled/total so the counter does not flash the
                // previous run's "N imported" during column sampling.
                if (syncState?.backfill_completed) {
                    await options.prisma.connectorSyncState.update({
                        where: { id: syncState.id },
                        data: {
                            backfill_completed: false,
                            backfill_completed_at: null,
                            backfill_records_pulled: 0,
                            backfill_total_records: null,
                            backfill_cursor: null,
                        },
                    });
                    afterKey = null;
                }
            }
            let guard = 0;
            let entityLastError = null;
            const entitySet = entitySets[entityType] ?? null;
            // Customer/Contact tables often lack a usable date column; scope via
            // pull_filters OData only. Invoice/Payment still use date windows.
            const usesDatePull = entityType === "Invoice" || entityType === "Payment";
            const applyDateWindow = Boolean(windowCutover) && usesDatePull;
            const entityPullFilter = (0, billingConnectorPullFilters_1.resolveImportPullFilterOData)(options.pullFilters, entityType);
            while (guard < 200) {
                if (options.shouldCancel?.()) {
                    log(`Stopped by operator before ${entityType} page ${guard}`);
                    windows.push({
                        window,
                        ok: true,
                        batchAfterPlugin: windowBatch,
                        imported: windowImported,
                        importErrors: windowErrors,
                    });
                    return finishWithBalances({
                        ok: true,
                        cancelled: true,
                        windows,
                        previewBatch,
                        stats: resultStats(),
                    });
                }
                guard += 1;
                log(`Pulling ${entityType} page ${guard}…`);
                const page = await options.provider.pull(entityType, {
                    since: usesDatePull && !applyDateWindow ? window.start : null,
                    createdOnOrAfter: applyDateWindow ? windowCutover : null,
                    preferredDateField: usesDatePull
                        ? options.dateFieldByType?.get(entityType) ?? null
                        : null,
                    overlapMinutes: options.overlapMinutes,
                    afterKey,
                    pagination: "keyset",
                    pageSize: priorityApiContract_1.PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet,
                    filter: entityPullFilter,
                    select: (0, prioritySelectFields_1.odataSelectFieldsFromMapping)({
                        mappingRules: rules,
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });
                const mappedPage = [];
                for (const raw of page.records) {
                    if (usesDatePull &&
                        !windowCutover &&
                        !recordInWindow(raw, window)) {
                        continue;
                    }
                    mappedPage.push((0, connectorFieldUtils_1.mapErpRecord)(raw, rules));
                }
                bumpProcessedPage(stats, entityType, mappedPage.length);
                log(`Pulled ${entityType} page ${guard}: ${page.records.length} record(s) (${stats[processedKey(entityType)]} in window)`);
                emitProgress();
                let pageRows = mappedPage;
                if (mappedPage.length > 0) {
                    try {
                        const afterPlugin = await options.extension.transform({
                            accountId: options.accountId,
                            window,
                            batch: { [entityType]: mappedPage },
                            extension_config: options.extensionConfig,
                        });
                        mergeBatch(previewBatch, afterPlugin);
                        mergeBatch(windowBatch, afterPlugin);
                        pageRows = afterPlugin[entityType] ?? [];
                    }
                    catch (err) {
                        const message = err instanceof Error
                            ? err.message
                            : "Extension plugin failed";
                        log(`Extension plugin failed: ${message}`);
                        windows.push({
                            window,
                            ok: false,
                            error: message,
                            batchAfterPlugin: windowBatch,
                            imported: windowImported,
                            importErrors: windowErrors,
                        });
                        return finishWithBalances({
                            ok: false,
                            windows,
                            previewBatch,
                            stats: resultStats(),
                            error: `Extension plugin failed for window: ${message}`,
                        });
                    }
                    if (dryRun) {
                        // Preview accumulates post-plugin rows; no entity writes.
                    }
                    else if (pageRows.length === 0) {
                        log(`No ${entityType} rows to import on page ${guard}`);
                    }
                    else {
                        log(`Importing ${pageRows.length} ${entityType} row(s)…`);
                        const importResult = await importFn(options.prisma, entityType, pageRows, options.accountId, null, options.userId, {
                            skipReportingBreach: options.skipReportingBreach === true,
                            skipDeferredPaymentMaturity: entityType === "Invoice",
                            onLog: options.onLog,
                            shouldCancel: options.shouldCancel,
                            extension: options.extension,
                        });
                        bumpImported(stats, entityType, importResult.success, importResult.failed);
                        windowImported += importResult.success;
                        windowErrors += importResult.failed;
                        if (entityType === "Payment" ||
                            entityType === "Invoice") {
                            for (const id of importResult.affectedCustomerIds) {
                                arAffectedCustomerIds.add(id);
                            }
                        }
                        log(`Imported ${entityType}: ${importResult.success} success, ${importResult.failed} failed`);
                        if (importResult.failed > 0) {
                            entityLastError =
                                importResult.errors.slice(0, 3).join("; ") ||
                                    entityLastError;
                            log(`${entityType} import had ${importResult.failed} failed row(s); continuing`);
                        }
                        emitProgress();
                        if (importResult.cancelled) {
                            await checkpointEntityPage({
                                prisma: options.prisma,
                                connectorId: options.connectorId,
                                entityType,
                                pulled: stats[processedKey(entityType)],
                                nextCursor: afterKey,
                                maxUpdated: pageRows.length > 0
                                    ? (0, entityImporter_1.extractMaxUpdatedAt)(pageRows)
                                    : null,
                                lastError: null,
                                pageComplete: false,
                            });
                            log(`Stopped by operator during ${entityType} import`);
                            windows.push({
                                window,
                                ok: true,
                                batchAfterPlugin: windowBatch,
                                imported: windowImported,
                                importErrors: windowErrors,
                            });
                            return finishWithBalances({
                                ok: true,
                                cancelled: true,
                                windows,
                                previewBatch,
                                stats: resultStats(),
                            });
                        }
                    }
                }
                const exhausted = !page.hasMore || !page.nextCursor;
                const nextCursor = exhausted ? null : page.nextCursor;
                if (!dryRun) {
                    await checkpointEntityPage({
                        prisma: options.prisma,
                        connectorId: options.connectorId,
                        entityType,
                        pulled: stats[processedKey(entityType)],
                        nextCursor,
                        maxUpdated: pageRows.length > 0
                            ? (0, entityImporter_1.extractMaxUpdatedAt)(pageRows)
                            : null,
                        lastError: entityLastError,
                        pageComplete: exhausted,
                    });
                }
                if (exhausted) {
                    break;
                }
                afterKey = page.nextCursor;
            }
            // Maturity once after all Invoice pages (not per page) so paging
            // stays fast; deferred payments from Payment-first ingest link here.
            if (!dryRun && entityType === "Invoice") {
                paymentLink.paymentLinkStatus = "running";
                paymentLink.paymentLinkError = undefined;
                paymentLink.paymentsLinked = 0;
                paymentLink.paymentsStillDeferred = 0;
                paymentLink.paymentsLinkTotal = 0;
                emitProgress();
                try {
                    const maturityStarted = Date.now();
                    const maturityResult = await (0, applyMaturedDeferredPayments_1.applyMaturedDeferredPayments)(options.prisma, options.accountId, new Date(), undefined, {
                        userId: options.userId,
                        onProgress: ({ linked, totalCandidates }) => {
                            paymentLink.paymentLinkStatus = "running";
                            paymentLink.paymentsLinked = linked;
                            paymentLink.paymentsLinkTotal = totalCandidates;
                            paymentLink.paymentsStillDeferred = Math.max(0, totalCandidates - linked);
                            emitProgress();
                        },
                    });
                    for (const id of maturityResult.affectedCustomerIds) {
                        arAffectedCustomerIds.add(id);
                    }
                    paymentLink.paymentLinkStatus = "done";
                    paymentLink.paymentsLinked = maturityResult.matured;
                    paymentLink.paymentsStillDeferred =
                        maturityResult.deferredRemaining;
                    paymentLink.paymentsLinkTotal =
                        maturityResult.totalCandidates;
                    emitProgress();
                    log(`Invoice entity maturity: ${maturityResult.matured} matured, ${maturityResult.deferredRemaining} still deferred in ${Date.now() - maturityStarted}ms`);
                }
                catch (error) {
                    const message = error instanceof Error
                        ? error.message
                        : "Deferred payment maturity failed";
                    paymentLink.paymentLinkStatus = "failed";
                    paymentLink.paymentLinkError = message;
                    emitProgress();
                    log(`Invoice entity maturity failed: ${message}`);
                }
            }
        }
        windows.push({
            window,
            ok: windowErrors === 0,
            batchAfterPlugin: windowBatch,
            imported: windowImported,
            importErrors: windowErrors,
            error: windowErrors > 0
                ? `${windowErrors} import error(s) in window`
                : undefined,
        });
    }
    const totalErrors = stats.importErrors;
    return finishWithBalances({
        ok: totalErrors === 0,
        windows,
        previewBatch,
        stats: resultStats(),
        error: totalErrors > 0
            ? `${totalErrors} import error(s)`
            : undefined,
    });
}
/**
 * Default window plan: one open window from the earliest watermark (or null)
 * through end (typically "now"). Callers may pass explicit windows for
 * multi-window backfills / tests.
 */
function planDefaultSyncWindows(params) {
    return [
        {
            start: params.earliestWatermark,
            end: params.end ?? null,
        },
    ];
}
