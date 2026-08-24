"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STAGED_ENTITY_ORDER = void 0;
exports.runStagedExtensionSync = runStagedExtensionSync;
exports.planDefaultSyncWindows = planDefaultSyncWindows;
const entityImporter_1 = require("../import/entityImporter");
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
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
async function pullAndMapWindow(params) {
    const batch = {};
    for (const entityType of params.enabledEntities) {
        const rules = params.mappingByType.get(entityType);
        if (!rules || rules.length === 0) {
            continue;
        }
        const mapped = [];
        let cursor = null;
        let guard = 0;
        while (guard < 100) {
            guard += 1;
            const page = await params.provider.pull(entityType, {
                since: params.window.start,
                cursor,
                pageSize: 100,
            });
            for (const raw of page.records) {
                if (!recordInWindow(raw, params.window)) {
                    continue;
                }
                mapped.push((0, connectorFieldUtils_1.mapErpRecord)(raw, rules));
            }
            if (!page.hasMore || !page.nextCursor) {
                break;
            }
            cursor = page.nextCursor;
        }
        batch[entityType] = mapped;
    }
    return batch;
}
function mergeBatch(target, source) {
    for (const entityType of exports.STAGED_ENTITY_ORDER) {
        const rows = source[entityType];
        if (!rows || rows.length === 0)
            continue;
        target[entityType] = [...(target[entityType] ?? []), ...rows];
    }
}
function bumpProcessed(stats, batch) {
    stats.customersProcessed += batch.Customer?.length ?? 0;
    stats.paymentsProcessed += batch.Payment?.length ?? 0;
    stats.invoicesProcessed += batch.Invoice?.length ?? 0;
    stats.contactsProcessed += batch.Contact?.length ?? 0;
}
function bumpImported(stats, entityType, success, failed) {
    const key = `${entityType.toLowerCase()}sImported`;
    stats[key] =
        (stats[key] ?? 0) + success;
    stats.importErrors += failed;
}
/**
 * Staged path: for each time/date window, pull+map all enabled entities,
 * run the extension plugin once, then persist in platform entity order.
 * Plugin failure fails the current window only; prior windows stay imported.
 * Never falls back to importing pre-plugin mapped rows.
 */
async function runStagedExtensionSync(options) {
    const stats = emptyStats();
    const windows = [];
    const previewBatch = {};
    const importFn = options.importBatch ?? entityImporter_1.importMappedEntityBatch;
    const dryRun = options.dryRun === true;
    for (const window of options.windows) {
        const mappedBatch = await pullAndMapWindow({
            provider: options.provider,
            mappingByType: options.mappingByType,
            enabledEntities: options.enabledEntities,
            window,
        });
        bumpProcessed(stats, mappedBatch);
        let afterPlugin;
        try {
            afterPlugin = await options.extension.transform({
                accountId: options.accountId,
                window,
                batch: mappedBatch,
                extension_config: options.extensionConfig,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Extension plugin failed";
            windows.push({
                window,
                ok: false,
                error: message,
                batchAfterPlugin: {},
                imported: 0,
                importErrors: 0,
            });
            return {
                ok: false,
                windows,
                previewBatch,
                stats,
                error: `Extension plugin failed for window: ${message}`,
            };
        }
        mergeBatch(previewBatch, afterPlugin);
        if (dryRun) {
            windows.push({
                window,
                ok: true,
                batchAfterPlugin: afterPlugin,
                imported: 0,
                importErrors: 0,
            });
            continue;
        }
        let windowImported = 0;
        let windowErrors = 0;
        for (const entityType of exports.STAGED_ENTITY_ORDER) {
            if (!options.enabledEntities.includes(entityType)) {
                continue;
            }
            const rows = afterPlugin[entityType] ?? [];
            if (rows.length === 0) {
                continue;
            }
            // Already mapped — pass null mapping so importer does not re-map.
            const importResult = await importFn(options.prisma, entityType, rows, options.accountId, null, options.userId, {
                skipReportingBreach: options.skipReportingBreach === true,
            });
            bumpImported(stats, entityType, importResult.success, importResult.failed);
            windowImported += importResult.success;
            windowErrors += importResult.failed;
            const maxUpdated = (0, entityImporter_1.extractMaxUpdatedAt)(rows) ?? new Date();
            await options.prisma.connectorSyncState.upsert({
                where: {
                    connector_id_entity_type: {
                        connector_id: options.connectorId,
                        entity_type: entityType,
                    },
                },
                create: {
                    connector_id: options.connectorId,
                    entity_type: entityType,
                    last_successful_run_at: new Date(),
                    last_attempt_at: new Date(),
                    last_max_updated_at: maxUpdated,
                    last_error: importResult.failed > 0
                        ? importResult.errors.slice(0, 3).join("; ")
                        : null,
                },
                update: {
                    last_successful_run_at: new Date(),
                    last_attempt_at: new Date(),
                    last_max_updated_at: maxUpdated,
                    last_error: importResult.failed > 0
                        ? importResult.errors.slice(0, 3).join("; ")
                        : null,
                },
            });
        }
        windows.push({
            window,
            ok: windowErrors === 0,
            batchAfterPlugin: afterPlugin,
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
