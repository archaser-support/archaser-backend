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
    type EntityImportBatchResult,
    type ImportEntityType,
} from "../import/entityImporter";
import { parseMappingRules, type MappingRule } from "../utils/connectorFieldUtils";
import { PRIORITY_RATE_LIMITS } from "../priority/priorityApiContract";
import { odataSelectFieldsFromMapping } from "../priority/prioritySelectFields";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveImportPullFilterOData } from "../services/billingConnectorPullFilters";
import {
    clearBeforeImport,
    parseCustomerIdForClearBeforeImport,
    resolveAccountCustomerById,
    type ClearBeforeImportEntity,
} from "../purge/clearBeforeImport";
import { isConnectorSyncCancelRequested } from "./connectorSyncCancelRegistry";
import {
    BALANCES_ENTITY_STATS_KEY,
    PROCESS_OVERDUE_ENTITY_STATS_KEY,
    entityStatsFromCounts,
    type ConnectorEntityStats,
    type ConnectorSyncCounts,
    type TailStepKey,
    type TailStepState,
} from "./connectorSyncRuntime";
import {
    planDefaultSyncWindows,
    runStagedExtensionSync,
    STAGED_ENTITY_ORDER,
    type ImportBatchFn,
} from "./stagedExtensionSync";
import { recalculateCustomerAmountsViaHost } from "../customers/recalculateCustomerAmountsHost";
import {
    type ArPostIngestHostFn,
    type ConnectorPostIngestDeferOptions,
} from "../credit/arPostIngestHost";
import { runInlineArPostIngestTailSteps } from "./arPostIngestTailSteps";
import {
    runProcessOverdueTailStep,
    type ProcessOverdueCustomersFn,
} from "./processOverdueTailStep";
import {
    emitBillingConnectorSyncFinish,
    emitBillingConnectorSyncStart,
    getDefaultBillingConnectorMetricsSink,
    type BillingConnectorObservabilityOptions,
} from "../observability";

export interface RunInProcessSyncOptions extends ConnectorPostIngestDeferOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
    /** Preview / dry-run: pull+map+plugin without entity DB writes. */
    dryRun?: boolean;
    /** In-process cancel / sync-run id (API cancel endpoint). */
    executionId?: string;
    mode?: "backfill" | "incremental";
    /**
     * Start backfill only: entities to purge before ERP pull/import.
     * Ignored for incremental, preview/dryRun, and when the host omits them on Resume.
     */
    clearBeforeImport?: ClearBeforeImportEntity[];
    /**
     * Start backfill only: optional Archaser customer_id scope for purge + pull.
     * Ignored for incremental, preview/dryRun, and Resume (host must omit).
     */
    customerId?: number | null;
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
    /**
     * After Payment/Invoice ingest (and deferred maturity), refresh denormalized
     * customer due/overdue amounts. Nest wires recalculateCustomerAmounts.
     */
    onCustomerBalancesFinal?: (customerIds: number[]) => Promise<void>;
    /**
     * After Invoice entity completion: shared AR post-ingest (replay, live
     * refresh, as-of enqueue). Nest wires runArPostIngestForCustomers.
     */
    onArPostIngest?: ArPostIngestHostFn;
    /**
     * One batched Process Overdue pass for touched customers before AR
     * post-ingest. Nest wires handleOverdueInvoices.
     */
    onProcessOverdueCustomers?: ProcessOverdueCustomersFn;
    /** Structured Loki JSON + Prometheus counters (start / finish / errors). */
    observability?: BillingConnectorObservabilityOptions;
    /** Account MEP breach start date — narrows AR replay event load when set. */
    mepBreachStartDate?: Date | null;
}

type SyncObsRuntime = {
    connectorId: number | null;
    provider: string;
    syncMode: string;
    startedAtMs: number;
    startEmitted: boolean;
};

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
    /** True when post-import was enqueued for worker drain (Mongo stays RUNNING). */
    postIngestDeferred?: boolean;
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

function emptyStats(): ConnectorSyncCounts {
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

async function finalizeLegacyCustomerBalances(
    customerIds: Set<number>,
    prisma: PrismaClient,
    onCustomerBalancesFinal:
        | ((customerIds: number[]) => Promise<void>)
        | undefined,
    log: (message: string) => void,
    setStep?: (key: TailStepKey, state: TailStepState) => void
): Promise<void> {
    if (customerIds.size === 0) {
        return;
    }
    const ids = Array.from(customerIds);
    const run =
        onCustomerBalancesFinal ??
        ((customerIdsToRecalc: number[]) =>
            recalculateCustomerAmountsViaHost(customerIdsToRecalc, prisma));
    setStep?.(BALANCES_ENTITY_STATS_KEY, {
        status: "running",
        total: ids.length,
    });
    try {
        await run(ids);
        log(
            `Recalculated customer due/overdue amounts for ${ids.length} customer(s)`
        );
        setStep?.(BALANCES_ENTITY_STATS_KEY, {
            status: "done",
            processed: ids.length,
            total: ids.length,
        });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Customer amount recalculation failed";
        log(`Customer amount recalculation failed: ${message}`);
        setStep?.(BALANCES_ENTITY_STATS_KEY, {
            status: "failed",
            total: ids.length,
            error: message,
        });
    }
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
function resolveInitialSyncMode(options: RunInProcessSyncOptions): string {
    if (options.mode === "incremental") return "INCREMENTAL";
    if (options.mode === "backfill") return "BACKFILL";
    return "UNKNOWN";
}

export async function runInProcessSync(
    options: RunInProcessSyncOptions
): Promise<RunInProcessSyncResult> {
    const obsRuntime: SyncObsRuntime = {
        connectorId: null,
        provider: "UNKNOWN",
        syncMode: resolveInitialSyncMode(options),
        startedAtMs: Date.now(),
        startEmitted: false,
    };
    const result = attachSyncMeta(
        await runInProcessSyncBody(options, obsRuntime),
        options
    );
    const structuredLogs = options.observability?.structuredLogs !== false;
    const metrics =
        options.observability?.metrics ??
        getDefaultBillingConnectorMetricsSink();
    // Skip dry-run / preview noise on Prometheus (still allow Loki if host wants).
    const emitMetrics = metrics && !options.dryRun ? metrics : null;
    emitBillingConnectorSyncFinish(
        {
            accountId: options.accountId,
            connectorId: obsRuntime.connectorId,
            provider: result.provider || obsRuntime.provider,
            syncMode: obsRuntime.syncMode,
            trigger: options.trigger ?? "manual",
            executionId: options.executionId,
            correlationId: options.observability?.correlationId,
            startedAtMs: obsRuntime.startedAtMs,
            result,
        },
        {
            onLog: options.onLog,
            metrics: emitMetrics,
            structuredLogs,
        }
    );
    return result;
}

async function runInProcessSyncBody(
    options: RunInProcessSyncOptions,
    obsRuntime: SyncObsRuntime
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
    const structuredLogs = options.observability?.structuredLogs !== false;
    const setTailStep = (key: TailStepKey, state: TailStepState) => {
        // A late `running` update must not resurrect a finished step.
        const current = stats.tailSteps?.[key];
        if (
            state.status === "running" &&
            (current?.status === "done" ||
                current?.status === "failed" ||
                current?.status === "queued")
        ) {
            return;
        }
        stats.tailSteps = { ...(stats.tailSteps ?? {}), [key]: state };
        emitProgress(options.onProgress, stats);
    };
    /** Inline Process Overdue → AR replay → insurance refresh for the progress panel. */
    const runArTailWithProgress = async (args: {
        customerIds: number[];
        invoiceEntityIds: number[];
        paymentEntityIds: number[];
        runMaturity: boolean;
        mepBreachStartDate?: Date | null;
    }): Promise<void> => {
        // Nest wires onProcessOverdueCustomers as its own step; skip overdue inside
        // runInlineArPostIngestTailSteps (separateOverdueStep) and run it here first.
        if (
            options.onProcessOverdueCustomers &&
            args.customerIds.length > 0
        ) {
            await runProcessOverdueTailStep({
                customerIds: args.customerIds,
                onProcessOverdueCustomers: options.onProcessOverdueCustomers,
                log,
                setTailStep: (state) =>
                    setTailStep(PROCESS_OVERDUE_ENTITY_STATS_KEY, state),
            });
        }
        await runInlineArPostIngestTailSteps({
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
            importType:
                args.invoiceEntityIds.length > 0 ? "Invoice" : "Payment",
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
            emitBillingConnectorSyncStart(
                {
                    accountId,
                    connectorId: connector.id,
                    provider: connector.provider,
                    syncMode: obsRuntime.syncMode,
                    trigger,
                    executionId: options.executionId,
                    correlationId: options.observability?.correlationId,
                },
                onLog,
                structuredLogs
            );
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

        const clearRequested =
            !dryRun &&
            options.mode === "backfill" &&
            Array.isArray(options.clearBeforeImport) &&
            options.clearBeforeImport.length > 0
                ? options.clearBeforeImport
                : [];
        const scopedCustomerId =
            !dryRun && options.mode === "backfill"
                ? parseCustomerIdForClearBeforeImport(options.customerId)
                : null;
        let runtimeCustomerNumber: string | null = null;
        let clearCustomerId: number | null = null;
        if (scopedCustomerId != null) {
            const customer = await resolveAccountCustomerById({
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
            log(
                `Customer scope for this Start: id=${customer.id} number=${customer.customer_number}`
            );
        }
        if (clearRequested.length > 0) {
            log(
                `Clear before import: ${clearRequested.join(", ")} (enabled ∩ requested)`
            );
            const applyDeletedCounts = (
                deleted: Partial<
                    Record<ClearBeforeImportEntity, number | undefined>
                >
            ) => {
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
            emitProgress(options.onProgress, stats);
            let purgeResult: Awaited<ReturnType<typeof clearBeforeImport>>;
            try {
                purgeResult = await clearBeforeImport({
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
                        const deletedSoFar =
                            (stats.customersDeleted ?? 0) +
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
                        emitProgress(options.onProgress, stats);
                    },
                });
            } catch (err) {
                const message =
                    err instanceof Error
                        ? err.message
                        : "Clear before import failed";
                log(`Clear before import failed: ${message}`);
                stats.purgeStatus = "cancelled";
                emitProgress(options.onProgress, stats);
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
                log(
                    `Cleared ${purgeResult.deleted.Customer} Customer row(s)`
                );
            }
            if (purgeResult.deleted.Contact != null) {
                log(`Cleared ${purgeResult.deleted.Contact} Contact row(s)`);
            }
            if (purgeResult.deleted.Invoice != null) {
                log(`Cleared ${purgeResult.deleted.Invoice} Invoice row(s)`);
            }
            if (purgeResult.deleted.Payment != null) {
                log(
                    `Cleared ${purgeResult.deleted.Payment} InvoicePayment row(s)`
                );
            }
            if (purgeResult.cancelled) {
                stats.purgeStatus = "cancelled";
                emitProgress(options.onProgress, stats);
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
            emitProgress(options.onProgress, stats);
        }

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
                onProgress: (liveStats) => {
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
                    emitProgress(options.onProgress, liveStats);
                },
                shouldCancel: () => isCancelRequested(options),
                onCustomerBalancesFinal: options.onCustomerBalancesFinal,
                onArPostIngest: options.onArPostIngest,
                onProcessOverdueCustomers: options.onProcessOverdueCustomers,
                deferPostIngest: options.deferPostIngest,
                enqueueDeferredSteps: options.enqueueDeferredSteps,
                schedulePostIngestDrain: options.schedulePostIngestDrain,
                mepBreachStartDate:
                    options.mepBreachStartDate ??
                    connector.mep_breach_start_date,
                pullCreatedOnOrAfter:
                    !isIncremental && Boolean(connector.backfill_start_date),
                pullFilters: connector.pull_filters,
                runtimeCustomerNumber,
                entitySets: connector.entity_sets,
                dateFieldByType,
                overlapMinutes: connector.sync_overlap_minutes,
            });

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

            // Preserve clear-before-import deleted counts (staged starts empty).
            const mergedStats: ConnectorSyncCounts = {
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
                if (!enabled.includes(entityType)) continue;
                const mapping = mappingByType.get(entityType);
                if (!mapping) continue;
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });
                const usesDatePull =
                    entityType === "Invoice" || entityType === "Payment";
                const pullResult = await client.pull(entityType, {
                    since: usesDatePull
                        ? syncState?.last_max_updated_at ?? null
                        : null,
                    preferredDateField: usesDatePull
                        ? dateFieldByType.get(entityType) ?? null
                        : null,
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
                (stats as unknown as Record<string, number>)[processedKey] =
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
        const arAffectedCustomerIds = new Set<number>();
        const arAffectedInvoiceIds = new Set<number>();
        const arAffectedPaymentIds = new Set<number>();
        const paymentAffectedCustomerIds = new Set<number>();
        let invoicePostIngestRan = false;
        for (const entityType of ENTITY_ORDER) {
            if (isCancelRequested(options)) {
                log("Stopped by operator");
                await finalizeLegacyCustomerBalances(
                    arAffectedCustomerIds,
                    prisma,
                    options.onCustomerBalancesFinal,
                    log
                );
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
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });

                const usesDatePull =
                    entityType === "Invoice" || entityType === "Payment";
                const pullResult = await client.pull(entityType, {
                    since: usesDatePull
                        ? syncState?.last_max_updated_at ?? null
                        : null,
                    preferredDateField: usesDatePull
                        ? dateFieldByType.get(entityType) ?? null
                        : null,
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
                (stats as unknown as Record<string, number>)[processedKey] =
                    pullResult.records.length;
                emitProgress(options.onProgress, stats);

                const importResult: EntityImportBatchResult = await importBatch(
                    prisma,
                    entityType,
                    pullResult.records as Record<string, unknown>[],
                    accountId,
                    mapping.mapping,
                    userId,
                    { skipReportingBreach, onLog, shouldCancel: () => isCancelRequested(options) }
                );
                (stats as unknown as Record<string, number>)[importedKey] =
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
                        } else {
                            arAffectedPaymentIds.add(id);
                        }
                    }
                }
                emitProgress(options.onProgress, stats);

                if (entityType === "Invoice") {
                    invoicePostIngestRan = true;
                    await runArTailWithProgress({
                        customerIds: Array.from(arAffectedCustomerIds),
                        invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                        paymentEntityIds: Array.from(arAffectedPaymentIds),
                        runMaturity: false,
                        mepBreachStartDate:
                            options.mepBreachStartDate ??
                            connector.mep_breach_start_date,
                    });
                }

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

        if (
            !invoicePostIngestRan &&
            paymentAffectedCustomerIds.size > 0
        ) {
            await runArTailWithProgress({
                customerIds: Array.from(paymentAffectedCustomerIds),
                invoiceEntityIds: [],
                paymentEntityIds: Array.from(arAffectedPaymentIds),
                runMaturity: true,
                mepBreachStartDate:
                    options.mepBreachStartDate ??
                    connector.mep_breach_start_date,
            });
        }

        await finalizeLegacyCustomerBalances(
            arAffectedCustomerIds,
            prisma,
            options.onCustomerBalancesFinal,
            log,
            setTailStep
        );

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
            postIngestDeferred: false,
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
