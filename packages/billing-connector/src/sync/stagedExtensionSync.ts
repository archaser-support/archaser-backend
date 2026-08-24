import type { PrismaClient } from "@prisma/client";

import type { BillingProviderClient } from "../billing/BillingProviderClient";
import type {
    BillingAccountExtension,
    ExtensionEntityType,
    ExtensionMappedBatch,
    ExtensionSyncWindow,
} from "../extensions/types";
import {
    importMappedEntityBatch,
    extractMaxUpdatedAt,
    type EntityImportBatchOptions,
    type EntityImportBatchResult,
    type ImportEntityType,
} from "../import/entityImporter";
import {
    mapErpRecord,
    type MappingRule,
} from "../utils/connectorFieldUtils";

export const STAGED_ENTITY_ORDER: ExtensionEntityType[] = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];

export type ImportBatchFn = (
    prisma: PrismaClient,
    importType: ImportEntityType,
    records: Record<string, unknown>[],
    accountId: number,
    mappingJson: unknown,
    userId?: string,
    options?: EntityImportBatchOptions
) => Promise<EntityImportBatchResult>;

export interface StagedWindowOutcome {
    window: ExtensionSyncWindow;
    ok: boolean;
    error?: string;
    batchAfterPlugin: ExtensionMappedBatch;
    imported: number;
    importErrors: number;
}

export interface RunStagedExtensionSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    connectorId: number;
    extension: BillingAccountExtension;
    extensionConfig: Record<string, unknown> | null;
    provider: BillingProviderClient;
    mappingByType: Map<string, MappingRule[]>;
    enabledEntities: ExtensionEntityType[];
    windows: ExtensionSyncWindow[];
    dryRun?: boolean;
    userId?: string;
    skipReportingBreach?: boolean;
    importBatch?: ImportBatchFn;
}

export interface RunStagedExtensionSyncResult {
    ok: boolean;
    windows: StagedWindowOutcome[];
    /** Aggregated post-plugin batches (preview / dry-run). */
    previewBatch: ExtensionMappedBatch;
    stats: {
        customersProcessed: number;
        contactsProcessed: number;
        invoicesProcessed: number;
        paymentsProcessed: number;
        customersImported: number;
        contactsImported: number;
        invoicesImported: number;
        paymentsImported: number;
        importErrors: number;
    };
    error?: string;
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

function recordInWindow(
    record: Record<string, unknown>,
    window: ExtensionSyncWindow
): boolean {
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

async function pullAndMapWindow(params: {
    provider: BillingProviderClient;
    mappingByType: Map<string, MappingRule[]>;
    enabledEntities: ExtensionEntityType[];
    window: ExtensionSyncWindow;
}): Promise<ExtensionMappedBatch> {
    const batch: ExtensionMappedBatch = {};

    for (const entityType of params.enabledEntities) {
        const rules = params.mappingByType.get(entityType);
        if (!rules || rules.length === 0) {
            continue;
        }

        const mapped: Record<string, unknown>[] = [];
        let cursor: string | null = null;
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
                mapped.push(mapErpRecord(raw, rules));
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

function mergeBatch(
    target: ExtensionMappedBatch,
    source: ExtensionMappedBatch
): void {
    for (const entityType of STAGED_ENTITY_ORDER) {
        const rows = source[entityType];
        if (!rows || rows.length === 0) continue;
        target[entityType] = [...(target[entityType] ?? []), ...rows];
    }
}

function bumpProcessed(
    stats: ReturnType<typeof emptyStats>,
    batch: ExtensionMappedBatch
): void {
    stats.customersProcessed += batch.Customer?.length ?? 0;
    stats.paymentsProcessed += batch.Payment?.length ?? 0;
    stats.invoicesProcessed += batch.Invoice?.length ?? 0;
    stats.contactsProcessed += batch.Contact?.length ?? 0;
}

function bumpImported(
    stats: ReturnType<typeof emptyStats>,
    entityType: ExtensionEntityType,
    success: number,
    failed: number
): void {
    const key =
        `${entityType.toLowerCase()}sImported` as keyof ReturnType<
            typeof emptyStats
        >;
    (stats as Record<string, number>)[key] =
        ((stats as Record<string, number>)[key] ?? 0) + success;
    stats.importErrors += failed;
}

/**
 * Staged path: for each time/date window, pull+map all enabled entities,
 * run the extension plugin once, then persist in platform entity order.
 * Plugin failure fails the current window only; prior windows stay imported.
 * Never falls back to importing pre-plugin mapped rows.
 */
export async function runStagedExtensionSync(
    options: RunStagedExtensionSyncOptions
): Promise<RunStagedExtensionSyncResult> {
    const stats = emptyStats();
    const windows: StagedWindowOutcome[] = [];
    const previewBatch: ExtensionMappedBatch = {};
    const importFn = options.importBatch ?? importMappedEntityBatch;
    const dryRun = options.dryRun === true;

    for (const window of options.windows) {
        const mappedBatch = await pullAndMapWindow({
            provider: options.provider,
            mappingByType: options.mappingByType,
            enabledEntities: options.enabledEntities,
            window,
        });
        bumpProcessed(stats, mappedBatch);

        let afterPlugin: ExtensionMappedBatch;
        try {
            afterPlugin = await options.extension.transform({
                accountId: options.accountId,
                window,
                batch: mappedBatch,
                extension_config: options.extensionConfig,
            });
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Extension plugin failed";
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

        for (const entityType of STAGED_ENTITY_ORDER) {
            if (!options.enabledEntities.includes(entityType)) {
                continue;
            }
            const rows = afterPlugin[entityType] ?? [];
            if (rows.length === 0) {
                continue;
            }

            // Already mapped — pass null mapping so importer does not re-map.
            const importResult = await importFn(
                options.prisma,
                entityType,
                rows,
                options.accountId,
                null,
                options.userId,
                {
                    skipReportingBreach: options.skipReportingBreach === true,
                }
            );
            bumpImported(
                stats,
                entityType,
                importResult.success,
                importResult.failed
            );
            windowImported += importResult.success;
            windowErrors += importResult.failed;

            const maxUpdated = extractMaxUpdatedAt(rows) ?? new Date();
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
                    last_error:
                        importResult.failed > 0
                            ? importResult.errors.slice(0, 3).join("; ")
                            : null,
                },
                update: {
                    last_successful_run_at: new Date(),
                    last_attempt_at: new Date(),
                    last_max_updated_at: maxUpdated,
                    last_error:
                        importResult.failed > 0
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
            error:
                windowErrors > 0
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
export function planDefaultSyncWindows(params: {
    earliestWatermark: Date | null;
    end?: Date;
}): ExtensionSyncWindow[] {
    return [
        {
            start: params.earliestWatermark,
            end: params.end ?? null,
        },
    ];
}
