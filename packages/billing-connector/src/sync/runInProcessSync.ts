import type { PrismaClient } from "@prisma/client";
import type { BillingProviderClient } from "../billing/BillingProviderClient";
import { getRegisteredExtension } from "../extensions";
import type {
    BillingAccountExtension,
    ExtensionEntityType,
    ExtensionMappedBatch,
    ExtensionSyncWindow,
} from "../extensions/types";
import { PriorityProviderClient } from "../priority/PriorityProviderClient";
import { testPriorityConnection } from "../priority/PriorityClient";
import { assertPriorityProvider } from "../provider";
import { decryptCredentials } from "../utils/billingConnectorCrypto";
import {
    extractMaxUpdatedAt,
    importMappedEntityBatch,
    shouldSkipReportingBreachOnConnectorWrite,
    updateAccountLastSyncDate,
    type EntityImportBatchResult,
    type ImportEntityType,
} from "../import/entityImporter";
import { parseMappingRules, type MappingRule } from "../utils/connectorFieldUtils";
import { PRIORITY_RATE_LIMITS } from "../priority/priorityApiContract";
import { odataSelectFieldsFromMapping } from "../priority/prioritySelectFields";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveImportPullFilterOData } from "../services/billingConnectorPullFilters";
import { isConnectorSyncCancelRequested } from "./connectorSyncCancelRegistry";
import {
    entityStatsFromCounts,
    type ConnectorEntityStats,
} from "./connectorSyncRuntime";
import {
    planDefaultSyncWindows,
    runStagedExtensionSync,
    STAGED_ENTITY_ORDER,
    type ImportBatchFn,
} from "./stagedExtensionSync";

export interface RunInProcessSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
    /** Preview / dry-run: pull+map+plugin without entity DB writes. */
    dryRun?: boolean;
    /** In-process cancel / sync-run id (API cancel endpoint). */
    executionId?: string;
    mode?: "backfill" | "incremental";
    /** Override window plan (multi-window backfills / tests). */
    windows?: ExtensionSyncWindow[];
    /** Injected provider (skips live Priority client construction). */
    provider?: BillingProviderClient;
    /** Skip live ERP connection test (used with injected provider). */
    skipConnectionTest?: boolean;
    /** Override registry lookup (tests). */
    resolveExtension?: (
        key: string
    ) => BillingAccountExtension | undefined;
    /** Override importer (tests / dry-run verification). */
    importBatch?: ImportBatchFn;
    /** Progress lines for the host process terminal (Nest Logger, tests). */
    onLog?: (message: string) => void;
    /** Live pulled/imported counts for GET /sync-runs polling. */
    onProgress?: (entityStats: ConnectorEntityStats) => void;
}

export interface RunInProcessSyncResult {
    ok: boolean;
    accountId: number;
    provider: string;
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
    message: string;
    error?: string;
    cancelled?: boolean;
    entity_stats?: Record<
        string,
        { pulled: number; success: number; failed: number; skipped: number }
    >;
    /** Present on staged extension preview / sync when a key is set. */
    extension_key?: string | null;
    dry_run?: boolean;
    /** Post-plugin mapped batch (especially useful for preview). */
    preview_batch?: ExtensionMappedBatch;
    window_outcomes?: Array<{
        start: Date | null;
        end: Date | null;
        ok: boolean;
        error?: string;
        imported: number;
    }>;
}

const ENTITY_ORDER: ImportEntityType[] = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];

function emitSyncLog(
    onLog: ((message: string) => void) | undefined,
    message: string
): void {
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

function emitProgress(
    onProgress: ((entityStats: ConnectorEntityStats) => void) | undefined,
    stats: ReturnType<typeof emptyStats>
): void {
    onProgress?.(entityStatsFromCounts(stats));
}

function entityStatsFrom(stats: ReturnType<typeof emptyStats>) {
    return entityStatsFromCounts(stats);
}

function attachSyncMeta(
    result: RunInProcessSyncResult,
    options: RunInProcessSyncOptions
): RunInProcessSyncResult {
    const cancelled = isCancelRequested(options) || Boolean(result.cancelled);
    return {
        ...result,
        cancelled,
        entity_stats: result.entity_stats ?? entityStatsFrom(result.stats),
    };
}

function isCancelRequested(options: RunInProcessSyncOptions): boolean {
    return Boolean(
        options.executionId &&
            isConnectorSyncCancelRequested(options.executionId)
    );
}

function normalizeExtensionConfig(
    value: unknown
): Record<string, unknown> | null {
    if (value == null) return null;
    if (typeof value !== "object" || Array.isArray(value)) return null;
    return { ...(value as Record<string, unknown>) };
}

function enabledEntitiesFromConnector(
    raw: unknown
): ExtensionEntityType[] {
    if (!Array.isArray(raw)) {
        return [...STAGED_ENTITY_ORDER];
    }
    return raw.filter(
        (e): e is ExtensionEntityType =>
            typeof e === "string" &&
            (STAGED_ENTITY_ORDER as string[]).includes(e)
    );
}

/**
 * In-process Priority sync for main API / worker (D71).
 * Accounts with extension_key use staged windowed plugin path;
 * accounts without a key keep entity-by-entity pull/map/import.
 */
export async function runInProcessSync(
    options: RunInProcessSyncOptions
): Promise<RunInProcessSyncResult> {
    return attachSyncMeta(await runInProcessSyncBody(options), options);
}

async function runInProcessSyncBody(
    options: RunInProcessSyncOptions
): Promise<RunInProcessSyncResult> {
    const {
        prisma,
        accountId,
        trigger = "manual",
        userId,
        dryRun = false,
        onLog,
    } = options;
    const stats = emptyStats();
    const resolveExtension =
        options.resolveExtension ?? getRegisteredExtension;
    const importBatch = options.importBatch ?? importMappedEntityBatch;
    const log = (message: string) => emitSyncLog(onLog, message);

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

        const extensionKey =
            typeof connector.extension_key === "string"
                ? connector.extension_key.trim() || null
                : null;

        const skipReportingBreach = shouldSkipReportingBreachOnConnectorWrite({
            syncMode: options.mode === "incremental" ? "INCREMENTAL" : "BACKFILL",
            skipReportingBreachOnBackfill:
                connector.skip_reporting_breach_on_backfill === true,
        });
        const enabled = enabledEntitiesFromConnector(
            connector.enabled_entities
        );
        log(
            `Starting ${options.mode ?? trigger}${dryRun ? " preview" : ""} for account ${accountId} (${enabled.join(", ")}${
                extensionKey ? `; extension ${extensionKey}` : ""
            })`
        );

        // Fail fast at sync start — never silently fall back to legacy path.
        let extension: BillingAccountExtension | undefined;
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
            assertPriorityProvider(connector.provider);
        } catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                stats,
                message: `Provider ${connector.provider} is not supported`,
                error:
                    err instanceof Error ? err.message : "UNSUPPORTED_PROVIDER",
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

        let credentials: Record<string, unknown> = {};
        if (!options.provider) {
            try {
                credentials = decryptCredentials(
                    connector.credentials_encrypted as string
                );
            } catch (err) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Failed to decrypt credentials",
                    error:
                        err instanceof Error
                            ? err.message
                            : "DECRYPTION_FAILED",
                };
            }
        }

        if (!options.skipConnectionTest && !options.provider) {
            log("Testing ERP connection…");
            const connectionResult = await testPriorityConnection({
                baseUrl: connector.base_url as string,
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

        const client: BillingProviderClient =
            options.provider ??
            new PriorityProviderClient({
                baseUrl: connector.base_url as string,
                authType: connector.auth_type,
                credentials,
                onLog,
            });

        const mappings = await prisma.connectorFieldMapping.findMany({
            where: { connector_id: connector.id },
        });
        const mappingByType = new Map(
            mappings.map((m) => [String(m.import_type), m])
        );
        const mappingRulesByType = new Map<string, MappingRule[]>(
            mappings.map((m) => [
                String(m.import_type),
                parseMappingRules(m.mapping),
            ])
        );
        const entitySets = parseEntitySetsMap(connector.entity_sets);
        const dateFieldByType = new Map<string, string | null>(
            mappings.map((row) => {
                const value =
                    "pull_date_field" in row
                        ? (row as { pull_date_field?: string | null })
                              .pull_date_field
                        : null;
                const trimmed =
                    typeof value === "string" ? value.trim() : "";
                return [String(row.import_type), trimmed || null];
            })
        );

        // -------- Staged extension path --------
        if (extensionKey && extension) {
            const isIncremental = options.mode === "incremental";
            let windows = options.windows;
            if (!windows) {
                if (isIncremental) {
                    let earliest: Date | null = null;
                    for (const entityType of enabled) {
                        const syncState =
                            await prisma.connectorSyncState.findFirst({
                                where: {
                                    connector_id: connector.id,
                                    entity_type: entityType,
                                },
                            });
                        const watermark = syncState?.last_max_updated_at ?? null;
                        if (
                            watermark &&
                            (!earliest || watermark < earliest)
                        ) {
                            earliest = watermark;
                        }
                    }
                    windows = planDefaultSyncWindows({
                        earliestWatermark: earliest,
                    });
                } else {
                    windows = planDefaultSyncWindows({
                        earliestWatermark: connector.backfill_start_date ?? null,
                    });
                }
            }

            const staged = await runStagedExtensionSync({
                prisma,
                accountId,
                connectorId: connector.id,
                extension,
                extensionConfig: normalizeExtensionConfig(
                    connector.extension_config
                ),
                provider: client,
                mappingByType: mappingRulesByType,
                enabledEntities: enabled,
                windows,
                dryRun,
                userId,
                skipReportingBreach,
                importBatch,
                onLog,
                onProgress: (liveStats) =>
                    emitProgress(options.onProgress, liveStats),
                shouldCancel: () => isCancelRequested(options),
                pullCreatedOnOrAfter:
                    !isIncremental && Boolean(connector.backfill_start_date),
                pullFilters: connector.pull_filters,
                entitySets: connector.entity_sets,
                dateFieldByType,
                overlapMinutes: connector.sync_overlap_minutes,
            });

            if (!dryRun && !staged.cancelled) {
                await updateAccountLastSyncDate(prisma, accountId);
            }

            const imported =
                staged.stats.customersImported +
                staged.stats.contactsImported +
                staged.stats.invoicesImported +
                staged.stats.paymentsImported;

            const finishMessage = staged.cancelled
                ? `Stopped by operator after importing ${imported} row(s)`
                : dryRun
                ? `Preview via ${trigger} (extension ${extensionKey}): processed without writes`
                : `Synced via ${trigger} (extension ${extensionKey}): imported ${imported} rows (${staged.stats.importErrors} errors)`;
            log(
                staged.ok
                    ? finishMessage
                    : `Sync failed: ${staged.error ?? finishMessage}`
            );

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
                if (!enabled.includes(entityType)) continue;
                const mapping = mappingByType.get(entityType);
                if (!mapping) continue;
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });
                const pullResult = await client.pull(entityType, {
                    since: syncState?.last_max_updated_at ?? null,
                    preferredDateField: dateFieldByType.get(entityType) ?? null,
                    overlapMinutes: connector.sync_overlap_minutes,
                    pageSize: PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet: entitySets[entityType] ?? null,
                    filter: resolveImportPullFilterOData(
                        connector.pull_filters,
                        entityType
                    ),
                    select: odataSelectFieldsFromMapping({
                        mappingRules: mappingRulesByType.get(entityType) ?? [],
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });
                const processedKey =
                    `${entityType.toLowerCase()}sProcessed` as keyof typeof stats;
                (stats as Record<string, number>)[processedKey] =
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
        for (const entityType of ENTITY_ORDER) {
            if (isCancelRequested(options)) {
                log("Stopped by operator");
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
            if (!enabled.includes(entityType)) continue;
            const mapping = mappingByType.get(entityType);
            if (!mapping) continue;

            try {
                log(`Pulling ${entityType}…`);
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });

                const pullResult = await client.pull(entityType, {
                    since: syncState?.last_max_updated_at ?? null,
                    preferredDateField: dateFieldByType.get(entityType) ?? null,
                    overlapMinutes: connector.sync_overlap_minutes,
                    pageSize: PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet: entitySets[entityType] ?? null,
                    filter: resolveImportPullFilterOData(
                        connector.pull_filters,
                        entityType
                    ),
                    select: odataSelectFieldsFromMapping({
                        mappingRules: mappingRulesByType.get(entityType) ?? [],
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });

                const processedKey =
                    `${entityType.toLowerCase()}sProcessed` as keyof typeof stats;
                const importedKey =
                    `${entityType.toLowerCase()}sImported` as keyof typeof stats;
                (stats as Record<string, number>)[processedKey] =
                    pullResult.records.length;
                log(
                    `Pulled ${entityType}: ${pullResult.records.length} record(s)`
                );
                emitProgress(options.onProgress, stats);

                log(
                    `Importing ${pullResult.records.length} ${entityType} row(s)…`
                );
                const importResult: EntityImportBatchResult = await importBatch(
                    prisma,
                    entityType,
                    pullResult.records as Record<string, unknown>[],
                    accountId,
                    mapping.mapping,
                    userId,
                    { skipReportingBreach, onLog, shouldCancel: () => isCancelRequested(options) }
                );
                (stats as Record<string, number>)[importedKey] =
                    importResult.success;
                stats.importErrors += importResult.failed;
                log(
                    `Imported ${entityType}: ${importResult.success} success, ${importResult.failed} failed`
                );
                emitProgress(options.onProgress, stats);

                const maxUpdated =
                    extractMaxUpdatedAt(
                        pullResult.records as Record<string, unknown>[]
                    ) ?? new Date();

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
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                    update: {
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        backfill_records_pulled: pullResult.records.length,
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                });
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "Unknown error";
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

        await updateAccountLastSyncDate(prisma, accountId);

        const imported =
            stats.customersImported +
            stats.contactsImported +
            stats.invoicesImported +
            stats.paymentsImported;

        log(
            `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`
        );

        return {
            ok: stats.importErrors === 0,
            accountId,
            provider: connector.provider,
            stats,
            extension_key: null,
            dry_run: false,
            message: `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`,
            error:
                stats.importErrors > 0
                    ? `${stats.importErrors} import error(s)`
                    : undefined,
        };
    } catch (err) {
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
