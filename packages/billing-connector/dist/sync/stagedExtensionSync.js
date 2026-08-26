"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGED_ENTITY_ORDER = void 0;
exports.runStagedExtensionSync = runStagedExtensionSync;
exports.planDefaultSyncWindows = planDefaultSyncWindows;
const entityImporter_1 = require("../import/entityImporter");
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
/**
 * Staged path: for each window and entity, pull one page, run the extension
 * plugin on that page, then upsert immediately. Prior pages stay imported if
 * a later page or window fails. Never falls back to importing pre-plugin rows.
 */
async function runStagedExtensionSync(options) {
    const stats = emptyStats();
    const windows = [];
    const previewBatch = {};
    const importFn = options.importBatch ?? entityImporter_1.importMappedEntityBatch;
    const dryRun = options.dryRun === true;
    const log = (message) => options.onLog?.(message);
    const emitProgress = () => options.onProgress?.(stats);
    const cutover = options.pullCreatedOnOrAfter === true;
    const entitySets = (0, billingConnectorEntitySets_1.parseEntitySetsMap)(options.entitySets);
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
            }
            let guard = 0;
            const entitySet = entitySets[entityType] ?? null;
            const applyDateWindow = Boolean(windowCutover) &&
                (entityType === "Invoice" || entityType === "Payment");
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
                    return {
                        ok: true,
                        cancelled: true,
                        windows,
                        previewBatch,
                        stats,
                    };
                }
                guard += 1;
                log(`Pulling ${entityType} page ${guard}…`);
                const page = await options.provider.pull(entityType, {
                    since: applyDateWindow ? null : window.start,
                    createdOnOrAfter: applyDateWindow ? windowCutover : null,
                    preferredDateField: options.dateFieldByType?.get(entityType) ?? null,
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
                    if (!windowCutover && !recordInWindow(raw, window)) {
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
                        return {
                            ok: false,
                            windows,
                            previewBatch,
                            stats,
                            error: `Extension plugin failed for window: ${message}`,
                        };
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
                            onLog: options.onLog,
                            shouldCancel: options.shouldCancel,
                        });
                        bumpImported(stats, entityType, importResult.success, importResult.failed);
                        windowImported += importResult.success;
                        windowErrors += importResult.failed;
                        log(`Imported ${entityType}: ${importResult.success} success, ${importResult.failed} failed`);
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
                            return {
                                ok: true,
                                cancelled: true,
                                windows,
                                previewBatch,
                                stats,
                            };
                        }
                        if (importResult.failed > 0) {
                            await checkpointEntityPage({
                                prisma: options.prisma,
                                connectorId: options.connectorId,
                                entityType,
                                pulled: stats[processedKey(entityType)],
                                nextCursor: afterKey,
                                maxUpdated: (0, entityImporter_1.extractMaxUpdatedAt)(pageRows),
                                lastError: importResult.errors
                                    .slice(0, 3)
                                    .join("; "),
                                pageComplete: false,
                            });
                            windows.push({
                                window,
                                ok: false,
                                batchAfterPlugin: windowBatch,
                                imported: windowImported,
                                importErrors: windowErrors,
                                error: `${windowErrors} import error(s) in window`,
                            });
                            return {
                                ok: false,
                                windows,
                                previewBatch,
                                stats,
                                error: `${windowErrors} import error(s) in window`,
                            };
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
                        lastError: null,
                        pageComplete: exhausted,
                    });
                }
                if (exhausted) {
                    break;
                }
                afterKey = page.nextCursor;
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
        if (windowErrors > 0) {
            return {
                ok: false,
                windows,
                previewBatch,
                stats,
                error: `${windowErrors} import error(s) in window`,
            };
        }
    }
    return {
        ok: true,
        windows,
        previewBatch,
        stats,
    };
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
