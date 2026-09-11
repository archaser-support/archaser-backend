import type { PrismaClient } from "@prisma/client";

import { countUniquePendingCloseInvoiceNumbers } from "../extensions/pendingCloseProgress";

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
    normalizeImportCacheCustomerScope,
    resolveImportCacheDay,
    rowsEnteringImport,
    saveEntityImportCacheOrThrow,
    savePendingInvoiceCloseCacheOrThrow,
    loadPendingInvoiceCloseCache,
    type ImportCacheSyncMode,
} from "../importCache";
import { applyMaturedDeferredPayments } from "../import/applyMaturedDeferredPayments";
import { recalculateCustomerAmountsViaHost } from "../customers/recalculateCustomerAmountsHost";
import {
    BALANCES_ENTITY_STATS_KEY,
    MATURITY_ENTITY_STATS_KEY,
    PENDING_CLOSES_ENTITY_STATS_KEY,
    PROCESS_OVERDUE_ENTITY_STATS_KEY,
    isEntityPipelineStatusKey,
    type ConnectorSyncCounts,
    type EntityPipelineStatusKey,
    type TailStepKey,
    type TailStepDetail,
    type TailStepState,
} from "./connectorSyncRuntime";
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
    mapErpRecord,
    type MappingRule,
} from "../utils/connectorFieldUtils";
import { PRIORITY_RATE_LIMITS } from "../priority/priorityApiContract";
import { odataSelectFieldsFromMapping } from "../priority/prioritySelectFields";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import {
    andODataFilters,
} from "../services/billingConnectorPullFilterCompile";
import {
    resolveImportPullFilterOData,
    resolveRuntimeCustomerScopeOData,
} from "../services/billingConnectorPullFilters";
import {
    getPaymentImportTraceKeys,
    isTracedPaymentRow,
    setPaymentImportTraceSink,
    tracePaymentImport,
    tracePaymentImportByRaw,
} from "../import/paymentImportTrace";

export const STAGED_ENTITY_ORDER: ExtensionEntityType[] = [
    "Customer",
    "Payment",
    "Invoice",
    "Contact",
];

/**
 * Max keyset pages per entity per window. At recommendedPageSize 500 this is
 * 2.5M rows — raised from 200 (100k) after Payment backfills exhausted early.
 */
const MAX_ENTITY_PAGES_PER_WINDOW = 5_000;

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

export interface RunStagedExtensionSyncOptions extends ConnectorPostIngestDeferOptions {
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
    onLog?: (message: string) => void;
    /** Live pulled/imported counts for GET /sync-runs polling. */
    onProgress?: (
        stats: RunStagedExtensionSyncResult["stats"],
        meta?: {
            activeStep?: string | null;
            activeStepDetail?: string | null;
        }
    ) => void;
    /** Cooperative cancel — checked between pages and after each import. */
    shouldCancel?: () => boolean;
    /**
     * After Payment/Invoice ingest + deferred maturity, refresh denormalized
     * customer due/overdue rollups for these customers (Nest wires
     * recalculateCustomerAmounts).
     */
    onCustomerBalancesFinal?: (
        customerIds: number[],
        options?: {
            onProgress?: (progress: {
                processed: number;
                total: number;
            }) => void;
        }
    ) => Promise<void>;
    /**
     * After Invoice entity completes (all pages + maturity), or as payment-only
     * fallback when Invoice did not orchestrate, run shared AR post-ingest.
     * Nest wires the orchestrator; default host-require keeps the package free
     * of a hard Nest dependency.
     */
    onArPostIngest?: ArPostIngestHostFn;
    /**
     * One batched Process Overdue pass for touched customers before AR
     * post-ingest. Nest wires handleOverdueInvoices.
     */
    onProcessOverdueCustomers?: ProcessOverdueCustomersFn;
    /**
     * Backfill cutover: Invoice/Payment $filter by created date (IVDATE/PAYDATE).
     * Customers and contacts still pull full history.
     */
    pullCreatedOnOrAfter?: boolean;
    /** Stored BillingConnector.pull_filters — applied on every live pull. */
    pullFilters?: unknown;
    /**
     * Start backfill only: Archaser customer_number for the resolved
     * customer_id. AND-ed into ERP OData (with optional extension-expanded
     * company-suffixed values for IDG payment tables) and used to keep mapped
     * rows for that customer after pull.
     */
    runtimeCustomerNumber?: string | null;
    /** Stored BillingConnector.entity_sets — overrides TOTARPAY / etc. */
    entitySets?: unknown;
    /** Per-entity mapping pull_date_field (admin pick). */
    dateFieldByType?: Map<string, string | null>;
    /** Incremental watermark overlap (minutes). */
    overlapMinutes?: number;
    /** Account MEP breach start date — narrows AR replay event load when set. */
    mepBreachStartDate?: Date | null;
    /** BACKFILL | INCREMENTAL — keys the Mongo import cache (not preview). */
    syncMode?: ImportCacheSyncMode;
    /** Sync execution id for cache metadata. */
    executionId?: string | null;
    /** Provider label for cache metadata (e.g. PRIORITY). */
    providerLabel?: string | null;
    /**
     * IANA timezone from BillingConnector.time_zone for cache_day.
     * Omit / null → Asia/Jerusalem.
     */
    timeZone?: string | null;
    /**
     * Manual Start only: already-loaded same-day mapped rows per entity.
     * Those entities skip ERP pull/map/plugin and import from cache.
     * Cron / scheduled sync must omit this.
     */
    cachedRowsByEntity?: Map<ExtensionEntityType, Record<string, unknown>[]>;
    /**
     * Execution id of the chosen import-cache backup (when replaying).
     * Used to load PendingInvoiceClose targets alongside Payment rows.
     */
    cachedImportExecutionId?: string | null;
}

export interface RunStagedExtensionSyncResult {
    ok: boolean;
    windows: StagedWindowOutcome[];
    /** Aggregated post-plugin batches (preview / dry-run). */
    previewBatch: ExtensionMappedBatch;
    /** Includes optional clear-before-import deleted/purge fields when merged by callers. */
    stats: ConnectorSyncCounts;
    cancelled?: boolean;
    error?: string;
    /** True when post-import was enqueued for worker drain (Mongo stays RUNNING). */
    postIngestDeferred?: boolean;
    invoicePostIngestRan?: boolean;
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

type PaymentLinkProgress = {
    paymentLinkStatus?: "running" | "done" | "failed";
    paymentsLinked: number;
    paymentsStillDeferred: number;
    paymentsLinkTotal: number;
    paymentLinkError?: string;
    paymentLinkDetail?: TailStepDetail;
};

function emptyPaymentLinkProgress(): PaymentLinkProgress {
    return {
        paymentLinkStatus: undefined,
        paymentsLinked: 0,
        paymentsStillDeferred: 0,
        paymentsLinkTotal: 0,
        paymentLinkError: undefined,
        paymentLinkDetail: undefined,
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

function bumpProcessedPage(
    stats: ReturnType<typeof emptyStats>,
    entityType: ExtensionEntityType,
    count: number
): void {
    (stats as Record<string, number>)[processedKey(entityType)] =
        ((stats as Record<string, number>)[processedKey(entityType)] ?? 0) +
        count;
}

function processedKey(
    entityType: ExtensionEntityType
): keyof ReturnType<typeof emptyStats> {
    return `${entityType.toLowerCase()}sProcessed` as keyof ReturnType<
        typeof emptyStats
    >;
}

/** ConnectorSyncState.backfill_cursor and last_error are varchar(500). */
const SYNC_STATE_TEXT_LIMIT = 500;

function clipSyncStateText(value: string | null | undefined): string | null {
    if (value == null || value === "") {
        return null;
    }
    if (value.length <= SYNC_STATE_TEXT_LIMIT) {
        return value;
    }
    return value.slice(0, SYNC_STATE_TEXT_LIMIT);
}

async function checkpointEntityPage(params: {
    prisma: PrismaClient;
    connectorId: number;
    entityType: ExtensionEntityType;
    pulled: number;
    nextCursor: string | null;
    maxUpdated: Date | null;
    lastError: string | null;
    pageComplete: boolean;
    pageSize: number;
    providerTotalCount?: number;
}): Promise<void> {
    const now = new Date();
    const nextCursor = clipSyncStateText(params.nextCursor);
    const lastError = clipSyncStateText(params.lastError);
    const backfill_total_records =
        params.providerTotalCount ??
        (params.pulled <= 0
            ? null
            : params.pageComplete
              ? params.pulled
              : Math.max(
                    params.pulled + params.pageSize,
                    params.pulled + 1
                ));
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
            backfill_total_records,
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
            backfill_total_records,
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

async function finalizeCustomerBalances(
    customerIds: Set<number>,
    prisma: PrismaClient,
    onCustomerBalancesFinal:
        | ((
              customerIds: number[],
              options?: {
                  onProgress?: (progress: {
                      processed: number;
                      total: number;
                  }) => void;
              }
          ) => Promise<void>)
        | undefined,
    log: (message: string) => void,
    setStep?: (key: TailStepKey, state: TailStepState) => void
): Promise<void> {
    if (customerIds.size === 0) {
        return;
    }
    const ids = Array.from(customerIds);
    const total = ids.length;
    const run =
        onCustomerBalancesFinal ??
        ((customerIdsToRecalc: number[], options?) =>
            recalculateCustomerAmountsViaHost(
                customerIdsToRecalc,
                prisma,
                options
            ));
    setStep?.(BALANCES_ENTITY_STATS_KEY, {
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
                setStep?.(BALANCES_ENTITY_STATS_KEY, {
                    status: "running",
                    processed,
                    total: progressTotal,
                    detail: {
                        step: "balances",
                        processed,
                        total: progressTotal,
                    },
                });
                log(
                    `Recalculate balances progress: ${processed}/${progressTotal} customer(s)`
                );
            },
        });
        log(
            `Recalculated customer due/overdue amounts for ${total} customer(s)`
        );
        setStep?.(BALANCES_ENTITY_STATS_KEY, {
            status: "done",
            processed: total,
            total,
            detail: {
                step: "balances",
                processed: total,
                total,
            },
        });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Customer amount recalculation failed";
        log(`Customer amount recalculation failed: ${message}`);
        setStep?.(BALANCES_ENTITY_STATS_KEY, {
            status: "failed",
            total,
            error: message,
        });
    }
}

/**
 * Staged path: for each window and entity, pull one page, run the extension
 * plugin on that page, then upsert immediately. Row-level import failures are
 * counted and checkpointed (`last_error`) but do not abort remaining pages,
 * entities, or windows. Never falls back to importing pre-plugin rows.
 */
export async function runStagedExtensionSync(
    options: RunStagedExtensionSyncOptions
): Promise<RunStagedExtensionSyncResult> {
    const stats = emptyStats();
    const paymentLink = emptyPaymentLinkProgress();
    const windows: StagedWindowOutcome[] = [];
    const previewBatch: ExtensionMappedBatch = {};
    const importFn = options.importBatch ?? importMappedEntityBatch;
    const dryRun = options.dryRun === true;
    const tailSteps: Partial<Record<TailStepKey, TailStepState>> = {};
    const log = (message: string) => options.onLog?.(message);
    const importCacheByEntity = new Map<
        ExtensionEntityType,
        Record<string, unknown>[]
    >();
    /** Entities already imported from Mongo cache (skip on later windows). */
    const cachedEntitiesDone = new Set<ExtensionEntityType>();
    const cacheSyncMode: ImportCacheSyncMode =
        options.syncMode === "INCREMENTAL" ? "INCREMENTAL" : "BACKFILL";
    const cacheCustomerScope = normalizeImportCacheCustomerScope(
        options.runtimeCustomerNumber
    );
    const flushEntityImportCache = async (entityType: ExtensionEntityType) => {
        if (dryRun) {
            return;
        }
        // Entities loaded from backup must not re-publish under this execution.
        if (cachedEntitiesDone.has(entityType)) {
            log(
                `Skipping import cache write for ${entityType} (loaded from backup)`
            );
            return;
        }
        const rows = importCacheByEntity.get(entityType) ?? [];
        // Track that we attempted a flush so zero-row successes still write.
        if (!importCacheByEntity.has(entityType)) {
            importCacheByEntity.set(entityType, rows);
        }
        const cacheDay = resolveImportCacheDay(new Date(), options.timeZone);
        await saveEntityImportCacheOrThrow(
            {
                accountId: options.accountId,
                connectorId: options.connectorId,
                provider: options.providerLabel?.trim() || "UNKNOWN",
                importType: entityType,
                syncMode: cacheSyncMode,
                cacheDay,
                customerScope: cacheCustomerScope,
                executionId: options.executionId ?? null,
                rows,
            },
            log
        );
        // Persist virtual-close IVNUMs with Payment so Helam-debit closes survive
        // cache replay (debit rows are dropped before Payment import/cache).
        if (entityType === "Payment" && pendingInvoiceCloses.size > 0) {
            await savePendingInvoiceCloseCacheOrThrow(
                {
                    accountId: options.accountId,
                    connectorId: options.connectorId,
                    provider: options.providerLabel?.trim() || "UNKNOWN",
                    syncMode: cacheSyncMode,
                    cacheDay,
                    customerScope: cacheCustomerScope,
                    executionId: options.executionId ?? null,
                    invoiceNumbers: pendingInvoiceCloses,
                    closeDates: pendingInvoiceCloseDates,
                },
                log
            );
        }
    };
    setPaymentImportTraceSink(log);
    const paymentTraceKeys = getPaymentImportTraceKeys();
    if (paymentTraceKeys.length > 0) {
        log(
            `[payment-trace] armed keys=${paymentTraceKeys.join(",")} (watch Nest logs for matching FNCNUM/IVNUM/FNCIREF1)`
        );
    }
    let activeStep: string | null = null;
    let activeStepDetail: string | null = null;
    const entityStatuses: Partial<
        Record<EntityPipelineStatusKey, "running" | "done" | "failed">
    > = {};
    let lastProgressEmitSignature = "";
    const emitProgress = () => {
        const signature = `cust=${stats.customersProcessed} pay=${stats.paymentsProcessed} inv=${stats.invoicesProcessed} contact=${stats.contactsProcessed} step=${activeStep ?? "none"}`;
        if (signature !== lastProgressEmitSignature) {
            lastProgressEmitSignature = signature;
        }
        options.onProgress?.(
            {
                ...stats,
                ...paymentLink,
                tailSteps: { ...tailSteps },
                entityStatuses: { ...entityStatuses },
            },
            { activeStep, activeStepDetail }
        );
    };
    const setActiveStep = (step: string, detail?: string | null) => {
        if (
            activeStep &&
            isEntityPipelineStatusKey(activeStep) &&
            activeStep !== step &&
            entityStatuses[activeStep] !== "failed"
        ) {
            entityStatuses[activeStep] = "done";
        }
        if (isEntityPipelineStatusKey(step)) {
            entityStatuses[step] = "running";
        }
        activeStep = step;
        activeStepDetail = detail ?? null;
    };
    const resultStats = () => ({
        ...stats,
        ...paymentLink,
        tailSteps: { ...tailSteps },
        entityStatuses: { ...entityStatuses },
    });
    const setTailStep = (key: TailStepKey, state: TailStepState) => {
        // A late `running` update must not resurrect a finished step.
        const current = tailSteps[key];
        if (
            state.status === "running" &&
            (current?.status === "done" ||
                current?.status === "failed" ||
                current?.status === "queued")
        ) {
            return;
        }
        tailSteps[key] = state;
        if (state.status === "running") {
            setActiveStep(key, state.detail?.step ?? null);
        } else if (
            (state.status === "done" || state.status === "failed") &&
            activeStep === key
        ) {
            // Clear so the UI does not keep the finished step as Running.
            activeStep = null;
            activeStepDetail = null;
        }
        emitProgress();
    };
    const cutover = options.pullCreatedOnOrAfter === true;
    const entitySets = parseEntitySetsMap(options.entitySets);
    const arAffectedCustomerIds = new Set<number>();
    const arAffectedInvoiceIds = new Set<number>();
    const arAffectedPaymentIds = new Set<number>();
    const paymentAffectedCustomerIds = new Set<number>();
    /** Reconciled payment-feed IVNUMs queued during Payment transform for virtual close. */
    const pendingInvoiceCloses = new Set<string>();
    /** ERP CURDATE per queued IVNUM — payment date for its virtual close. */
    const pendingInvoiceCloseDates = new Map<string, Date>();
    let invoicePostIngestRan = false;

    const flushExtensionPendingCloses = async (label: string) => {
        if (
            pendingInvoiceCloses.size === 0 ||
            !options.extension.flushPendingInvoiceCloses
        ) {
            return;
        }
        const pendingNumbers = Array.from(pendingInvoiceCloses);
        const pendingTotal =
            countUniquePendingCloseInvoiceNumbers(pendingNumbers);
        setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
            status: "running",
            processed: 0,
            total: pendingTotal,
        });
        try {
            const flushResult =
                await options.extension.flushPendingInvoiceCloses({
                    prisma: options.prisma,
                    accountId: options.accountId,
                    userId: options.userId,
                    invoiceNumbers: pendingNumbers,
                    invoiceCloseDates: new Map(pendingInvoiceCloseDates),
                    onProgress: ({ processed, total }) => {
                        setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
                            status: "running",
                            processed,
                            total,
                        });
                    },
                });
            for (const invoiceId of flushResult.closedIds) {
                arAffectedInvoiceIds.add(invoiceId);
            }
            for (const customerId of flushResult.customerIds ?? []) {
                arAffectedCustomerIds.add(customerId);
            }
            const missing = flushResult.missingNumbers ?? [];
            pendingInvoiceCloses.clear();
            // Keep close dates for numbers that still need a retry after Invoice.
            const missingSet = new Set(missing);
            for (const invoiceNumber of Array.from(
                pendingInvoiceCloseDates.keys()
            )) {
                if (!missingSet.has(invoiceNumber)) {
                    pendingInvoiceCloseDates.delete(invoiceNumber);
                }
            }
            for (const invoiceNumber of missing) {
                pendingInvoiceCloses.add(invoiceNumber);
            }
            const settled = flushResult.closedIds.length;
            log(
                `Extension pending invoice closes (${label}): ${settled} settled, ${missing.length} missing of ${pendingNumbers.length} queued`
            );
            setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
                status: "done",
                processed: settled,
                total: pendingTotal,
                skipped: missing.length,
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Pending invoice close flush failed";
            log(
                `Extension pending invoice closes failed (${label}): ${message}`
            );
            setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
                status: "failed",
                total: pendingTotal,
                error: message,
            });
        }
    };

    /** Inline Process Overdue → AR replay → insurance refresh for the progress panel. */
    const runArTailWithProgress = async (args: {
        customerIds: number[];
        invoiceEntityIds: number[];
        paymentEntityIds: number[];
        runMaturity: boolean;
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
                prisma: options.prisma,
                setTailStep: (state) =>
                    setTailStep(PROCESS_OVERDUE_ENTITY_STATS_KEY, state),
            });
        }
        await runInlineArPostIngestTailSteps({
            accountId: options.accountId,
            customerIds: args.customerIds,
            invoiceEntityIds: args.invoiceEntityIds,
            paymentEntityIds: args.paymentEntityIds,
            mepBreachStartDate: options.mepBreachStartDate,
            prisma: options.prisma,
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

    const finishWithBalances = async (
        result: RunStagedExtensionSyncResult
    ): Promise<RunStagedExtensionSyncResult> => {
        try {
            if (!dryRun && !result.cancelled) {
                await flushExtensionPendingCloses("finalize");
                if (pendingInvoiceCloses.size > 0) {
                    log(
                        `Extension pending invoice closes still missing after finalize: ${pendingInvoiceCloses.size} (${Array.from(pendingInvoiceCloses).slice(0, 20).join(", ")}${pendingInvoiceCloses.size > 20 ? ", …" : ""})`
                    );
                }
                // Payment-only (or Invoice-not-orchestrated) fallback: same
                // orchestrator as post-Invoice, including deferred maturity.
                // Skip when Invoice already ran post-ingest in this sync.
                if (
                    !invoicePostIngestRan &&
                    paymentAffectedCustomerIds.size > 0
                ) {
                    await runArTailWithProgress({
                        customerIds: Array.from(paymentAffectedCustomerIds),
                        invoiceEntityIds: [],
                        paymentEntityIds: Array.from(arAffectedPaymentIds),
                        runMaturity: true,
                    });
                }
                await finalizeCustomerBalances(
                    arAffectedCustomerIds,
                    options.prisma,
                    options.onCustomerBalancesFinal,
                    log,
                    setTailStep
                );
            }
            return {
                ...result,
                // Refresh after balances / late AR tail so finish logs include them.
                stats: resultStats(),
                invoicePostIngestRan,
                postIngestDeferred: false,
            };
        } finally {
            setPaymentImportTraceSink(null);
        }
    };

    const flushEntityImportCacheOrAbort = async (
        entityType: ExtensionEntityType
    ): Promise<RunStagedExtensionSyncResult | null> => {
        try {
            await flushEntityImportCache(entityType);
            return null;
        } catch (err) {
            const message =
                err instanceof Error ? err.message : String(err);
            log(`Import cache save failed for ${entityType}: ${message}`);
            stats.importErrors += 1;
            return finishWithBalances({
                ok: false,
                windows,
                previewBatch,
                stats: resultStats(),
                error: `Import cache save failed for ${entityType}: ${message}`,
            });
        }
    };

    for (let windowIndex = 0; windowIndex < options.windows.length; windowIndex += 1) {
        const window = options.windows[windowIndex]!;
        const isLastWindow = windowIndex === options.windows.length - 1;
        log(
            window.start || window.end
                ? `Window ${window.start?.toISOString() ?? "start"} → ${window.end?.toISOString() ?? "now"}`
                : "Pulling full-history window"
        );
        const windowBatch: ExtensionMappedBatch = {};
        let windowImported = 0;
        let windowErrors = 0;
        const windowCutover =
            cutover && window.start ? window.start : null;

        for (const entityType of STAGED_ENTITY_ORDER) {
            if (!options.enabledEntities.includes(entityType)) {
                continue;
            }

            const cachedRows = options.cachedRowsByEntity?.get(entityType);
            if (cachedRows !== undefined) {
                if (cachedEntitiesDone.has(entityType)) {
                    continue;
                }
                cachedEntitiesDone.add(entityType);
                log(
                    `Using same-day import cache for ${entityType} (${cachedRows.length} row(s)); skipping ERP pull`
                );
                if (
                    entityType === "Payment" &&
                    typeof options.cachedImportExecutionId === "string" &&
                    options.cachedImportExecutionId.trim().length > 0
                ) {
                    try {
                        const closeTargets = await loadPendingInvoiceCloseCache({
                            accountId: options.accountId,
                            executionId: options.cachedImportExecutionId.trim(),
                            syncMode: cacheSyncMode,
                            customerScope: cacheCustomerScope,
                        });
                        for (const invoiceNumber of closeTargets.invoiceNumbers) {
                            pendingInvoiceCloses.add(invoiceNumber);
                        }
                        for (const [invoiceNumber, iso] of Object.entries(
                            closeTargets.closeDates
                        )) {
                            const parsed = new Date(iso);
                            if (!Number.isNaN(parsed.getTime())) {
                                pendingInvoiceCloseDates.set(
                                    invoiceNumber,
                                    parsed
                                );
                            }
                        }
                        if (closeTargets.invoiceNumbers.length > 0) {
                            log(
                                `Loaded ${closeTargets.invoiceNumbers.length} pending invoice close target(s) from import cache execution=${options.cachedImportExecutionId}`
                            );
                        }
                    } catch (err) {
                        const message =
                            err instanceof Error ? err.message : String(err);
                        log(
                            `Pending invoice close cache load failed: ${message}`
                        );
                    }
                }
                setActiveStep(entityType, "importing");
                bumpProcessedPage(stats, entityType, cachedRows.length);
                emitProgress();
                if (!dryRun && cachedRows.length > 0) {
                    const cacheRowsKept: Record<string, unknown>[] = [];
                    const importErrors: string[] = [];
                    let importedTotal = 0;
                    let failedTotal = 0;
                    const chunkSize = PRIORITY_RATE_LIMITS.recommendedPageSize;
                    for (let i = 0; i < cachedRows.length; i += chunkSize) {
                        const chunk = cachedRows.slice(i, i + chunkSize);
                        if (chunk.length === 0) {
                            continue;
                        }
                        const importResult = await importFn(
                            options.prisma,
                            entityType,
                            chunk,
                            options.accountId,
                            null,
                            options.userId,
                            {
                                skipReportingBreach:
                                    options.skipReportingBreach === true,
                                skipDeferredPaymentMaturity:
                                    entityType === "Invoice",
                                onLog: options.onLog,
                                shouldCancel: options.shouldCancel,
                                extension: options.extension,
                            }
                        );
                        importedTotal += importResult.success;
                        failedTotal += importResult.failed;
                        importErrors.push(...importResult.errors);
                        const cacheRows = rowsEnteringImport(chunk, importResult);
                        if (cacheRows.length > 0) {
                            cacheRowsKept.push(...cacheRows);
                        }
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
                        bumpImported(
                            stats,
                            entityType,
                            importResult.success,
                            importResult.failed
                        );
                        emitProgress();
                    }
                    // Intentionally not staging rows into importCacheByEntity:
                    // cache replay must not append a new Mongo backup (R1).
                    windowImported += importedTotal;
                    windowErrors += failedTotal;
                    await checkpointEntityPage({
                        prisma: options.prisma,
                        connectorId: options.connectorId,
                        entityType,
                        pulled: cachedRows.length,
                        nextCursor: null,
                        maxUpdated:
                            cacheRowsKept.length > 0
                                ? extractMaxUpdatedAt(cacheRowsKept)
                                : null,
                        lastError:
                            failedTotal > 0
                                ? importErrors.slice(0, 3).join("; ")
                                : null,
                        pageComplete: true,
                        pageSize: cachedRows.length || 1,
                        providerTotalCount: cachedRows.length,
                    });
                } else if (!dryRun) {
                    await checkpointEntityPage({
                        prisma: options.prisma,
                        connectorId: options.connectorId,
                        entityType,
                        pulled: 0,
                        nextCursor: null,
                        maxUpdated: null,
                        lastError: null,
                        pageComplete: true,
                        pageSize: 1,
                        providerTotalCount: 0,
                    });
                }
                emitProgress();

                if (!dryRun && entityType === "Invoice") {
                    setActiveStep(MATURITY_ENTITY_STATS_KEY, "linking");
                    paymentLink.paymentLinkStatus = "running";
                    paymentLink.paymentLinkError = undefined;
                    paymentLink.paymentsLinked = 0;
                    paymentLink.paymentsStillDeferred = 0;
                    paymentLink.paymentsLinkTotal = 0;
                    emitProgress();
                    try {
                        const maturityStarted = Date.now();
                        const maturityResult =
                            await applyMaturedDeferredPayments(
                                options.prisma,
                                options.accountId,
                                new Date(),
                                undefined,
                                {
                                    userId: options.userId,
                                    onProgress: ({
                                        linked,
                                        totalCandidates,
                                        detail,
                                    }) => {
                                        paymentLink.paymentLinkStatus =
                                            "running";
                                        paymentLink.paymentsLinked = linked;
                                        paymentLink.paymentsLinkTotal =
                                            totalCandidates;
                                        paymentLink.paymentsStillDeferred =
                                            Math.max(
                                                0,
                                                totalCandidates - linked
                                            );
                                        paymentLink.paymentLinkDetail = detail;
                                        emitProgress();
                                    },
                                }
                            );
                        for (const id of maturityResult.affectedCustomerIds) {
                            arAffectedCustomerIds.add(id);
                        }
                        paymentLink.paymentLinkStatus = "done";
                        paymentLink.paymentLinkDetail = undefined;
                        paymentLink.paymentsLinked = maturityResult.matured;
                        paymentLink.paymentsStillDeferred =
                            maturityResult.deferredRemaining;
                        paymentLink.paymentsLinkTotal =
                            maturityResult.totalCandidates;
                        if (activeStep === MATURITY_ENTITY_STATS_KEY) {
                            activeStep = null;
                            activeStepDetail = null;
                        }
                        emitProgress();
                        log(
                            `Invoice entity maturity: ${maturityResult.matured} matured, ${maturityResult.deferredRemaining} still deferred in ${Date.now() - maturityStarted}ms`
                        );
                    } catch (error) {
                        const message =
                            error instanceof Error
                                ? error.message
                                : "Deferred payment maturity failed";
                        paymentLink.paymentLinkStatus = "failed";
                        paymentLink.paymentLinkError = message;
                        if (activeStep === MATURITY_ENTITY_STATS_KEY) {
                            activeStep = null;
                            activeStepDetail = null;
                        }
                        emitProgress();
                        log(`Invoice entity maturity failed: ${message}`);
                    }

                    if (pendingInvoiceCloses.size > 0) {
                        await flushExtensionPendingCloses("after Invoice");
                    }

                    invoicePostIngestRan = true;
                    await runArTailWithProgress({
                        customerIds: Array.from(arAffectedCustomerIds),
                        invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                        paymentEntityIds: Array.from(arAffectedPaymentIds),
                        runMaturity: false,
                    });
                }

                // Replay keeps the source backup — skip Mongo write (and
                // Payment PendingInvoiceClose companion) under this execution.
                log(
                    `Skipping import cache write for ${entityType} (loaded from backup)`
                );
                continue;
            }

            const rules = options.mappingByType.get(entityType);
            if (!rules || rules.length === 0) {
                log(`Skipping ${entityType}: no field mapping configured`);
                continue;
            }

            let afterKey: string | null = null;
            if (!dryRun) {
                const syncState =
                    await options.prisma.connectorSyncState.findFirst({
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
                // Incremental must NOT clear completion — a Stop mid-run would
                // leave entities incomplete and demote the connector to Backfill.
                if (
                    syncState?.backfill_completed &&
                    cacheSyncMode !== "INCREMENTAL"
                ) {
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
            let entityLastError: string | null = null;
            const entityPageSize = PRIORITY_RATE_LIMITS.recommendedPageSize;
            setActiveStep(entityType, "sampling");
            emitProgress();
            const entitySet = entitySets[entityType] ?? null;
            // Customer/Contact tables often lack a usable date column; scope via
            // pull_filters OData only. Invoice/Payment still use date windows.
            const usesDatePull =
                entityType === "Invoice" || entityType === "Payment";
            const applyDateWindow =
                Boolean(windowCutover) && usesDatePull;
            const scopedCustomerNumber =
                typeof options.runtimeCustomerNumber === "string"
                    ? options.runtimeCustomerNumber.trim()
                    : "";
            const scopeToCustomer = scopedCustomerNumber.length > 0;
            const additionalCustomerNumbers =
                scopeToCustomer &&
                typeof options.extension.expandRuntimeCustomerScopeNumbers ===
                    "function"
                    ? options.extension.expandRuntimeCustomerScopeNumbers({
                          customerNumber: scopedCustomerNumber,
                          entityType,
                          entitySet,
                          extension_config: options.extensionConfig,
                      })
                    : [];
            const allowedCustomerNumbers = new Set<string>([
                scopedCustomerNumber,
                ...additionalCustomerNumbers
                    .map((value) =>
                        typeof value === "string" ? value.trim() : ""
                    )
                    .filter((value) => value.length > 0),
            ]);
            const baseEntityPullFilter = resolveImportPullFilterOData(
                options.pullFilters,
                entityType,
                { entitySet }
            );
            const extensionScopeClause =
                scopeToCustomer &&
                typeof options.extension.buildRuntimeCustomerScopeOData ===
                    "function"
                    ? options.extension.buildRuntimeCustomerScopeOData({
                          customerNumber: scopedCustomerNumber,
                          additionalCustomerNumbers,
                          entityType,
                          entitySet,
                          extension_config: options.extensionConfig,
                      })
                    : null;
            const runtimeCustomerClause =
                (typeof extensionScopeClause === "string" &&
                extensionScopeClause.trim().length > 0
                    ? extensionScopeClause.trim()
                    : null) ??
                resolveRuntimeCustomerScopeOData({
                    customerNumber: scopedCustomerNumber || null,
                    additionalCustomerNumbers,
                    entityType,
                    entitySet,
                });
            const primaryPullFilter = andODataFilters(
                baseEntityPullFilter,
                runtimeCustomerClause
            );
            const fallbackScopeClause =
                entityType === "Payment" &&
                scopeToCustomer &&
                typeof options.extension
                    .buildRuntimeCustomerScopeFallbackOData === "function"
                    ? options.extension.buildRuntimeCustomerScopeFallbackOData({
                          customerNumber: scopedCustomerNumber,
                          entityType,
                          entitySet,
                          extension_config: options.extensionConfig,
                      })
                    : null;
            const fallbackPullFilter =
                typeof fallbackScopeClause === "string" &&
                fallbackScopeClause.trim().length > 0
                    ? andODataFilters(
                          baseEntityPullFilter,
                          fallbackScopeClause.trim()
                      )
                    : null;
            const expandPullPhases = (
                labelPrefix: string,
                filter: string | null,
                startAfterKey: string | null
            ): Array<{
                label: string;
                filter: string | null;
                startAfterKey: string | null;
            }> => {
                if (!filter) {
                    return [{ label: labelPrefix, filter, startAfterKey }];
                }
                const expanded =
                    typeof options.extension.expandEntityPullFilters ===
                    "function"
                        ? options.extension.expandEntityPullFilters({
                              entityType,
                              entitySet,
                              filter,
                              extension_config: options.extensionConfig,
                          })
                        : null;
                if (!expanded || expanded.length <= 1) {
                    return [
                        {
                            label: labelPrefix,
                            filter: expanded?.[0] ?? filter,
                            startAfterKey,
                        },
                    ];
                }
                log(
                    `[payment-watch] ${entityType} ${labelPrefix} split into ${expanded.length} extension pulls`
                );
                return expanded.map((phaseFilter, index) => ({
                    label: `${labelPrefix}_part_${index + 1}`,
                    filter: phaseFilter,
                    startAfterKey: index === 0 ? startAfterKey : null,
                }));
            };
            const pullPhases: Array<{
                label: string;
                filter: string | null;
                /** Resume cursor only for the primary phase. */
                startAfterKey: string | null;
            }> = [...expandPullPhases("primary", primaryPullFilter, afterKey)];
            if (fallbackPullFilter) {
                pullPhases.push(
                    ...expandPullPhases(
                        "idc_fallback",
                        fallbackPullFilter,
                        null
                    )
                );
            }

            let watchedPaymentSeen = false;
            for (const phase of pullPhases) {
                afterKey = phase.startAfterKey;
                if (entityType === "Payment") {
                    const filterText = phase.filter ?? "";
                    log(
                        `[payment-watch] Payment ${phase.label} filterLen=${filterText.length} hasAccname=${filterText.includes("ACCNAME")} hasIdcCustnameIv=${filterText.includes("IDC_CUSTNAMEIV")} hasIdgCustname=${filterText.includes("IDG_CUSTNAME")} filterPreview=${filterText.slice(0, 360)}`
                    );
                }

            while (guard < MAX_ENTITY_PAGES_PER_WINDOW) {
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
                setActiveStep(entityType, "pulling");
                let page;
                try {
                    page = await options.provider.pull(entityType, {
                        since:
                            usesDatePull && !applyDateWindow
                                ? window.start
                                : null,
                        createdOnOrAfter: applyDateWindow
                            ? windowCutover
                            : null,
                        preferredDateField: usesDatePull
                            ? options.dateFieldByType?.get(entityType) ?? null
                            : null,
                        overlapMinutes: options.overlapMinutes,
                        afterKey,
                        pagination: "keyset",
                        pageSize: entityPageSize,
                        entitySet,
                        filter: phase.filter,
                        keysetOrderFields:
                            typeof options.extension
                                .resolvePullKeysetOrderFields === "function"
                                ? options.extension.resolvePullKeysetOrderFields(
                                      {
                                          entityType,
                                          entitySet,
                                          extension_config:
                                              options.extensionConfig,
                                      }
                                  )
                                : null,
                        select: odataSelectFieldsFromMapping({
                            mappingRules: rules,
                            extraFields: [
                                "UDATE",
                                ...(typeof options.extension
                                    .extraSelectFields === "function"
                                    ? options.extension.extraSelectFields({
                                          entityType,
                                          entitySet,
                                          extension_config:
                                              options.extensionConfig,
                                      })
                                    : []),
                            ],
                            entityType,
                        }),
                    });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    if (entityType === "Payment") {
                        log(
                            `[payment-watch] Payment ${phase.label} pull FAILED page=${guard} afterKey=${afterKey ?? "null"} error=${message} filterPreview=${(phase.filter ?? "").slice(0, 360)}`
                        );
                    }
                    throw err;
                }
                if (entityType === "Payment") {
                    log(
                        `[payment-watch] Payment ${phase.label} page=${guard} rawRows=${page.records.length} hasMore=${page.hasMore} watchedSeen=${watchedPaymentSeen}`
                    );
                }

                const mappedPage: Record<string, unknown>[] = [];
                let idcFallbackDroppedIdg = 0;
                for (const raw of page.records) {
                    if (entityType === "Payment" && isTracedPaymentRow(raw)) {
                        watchedPaymentSeen = true;
                        tracePaymentImportByRaw("erp_page_raw", raw, {
                            pageGuard: guard,
                            pageRecordCount: page.records.length,
                            phase: phase.label,
                        });
                    }
                    // IDC fallback: keep Helam/VAT lines only (empty IDG).
                    // Priority rejects IDG null in $filter, so partition here.
                    if (
                        entityType === "Payment" &&
                        phase.label.startsWith("idc_fallback")
                    ) {
                        const idg = String(raw.IDG_CUSTNAME ?? "").trim();
                        if (idg.length > 0) {
                            idcFallbackDroppedIdg += 1;
                            if (isTracedPaymentRow(raw)) {
                                tracePaymentImportByRaw(
                                    "idc_fallback_skip_has_idg",
                                    raw,
                                    { idgCustname: idg }
                                );
                            }
                            continue;
                        }
                    }
                    if (
                        usesDatePull &&
                        !windowCutover &&
                        !recordInWindow(raw, window)
                    ) {
                        if (entityType === "Payment") {
                            tracePaymentImportByRaw("pull_skip_date_window", raw, {
                                windowStart: window.start?.toISOString() ?? null,
                                windowEnd: window.end?.toISOString() ?? null,
                                phase: phase.label,
                            });
                        }
                        continue;
                    }
                    const mapped = mapErpRecord(raw, rules);
                    if (entityType === "Payment") {
                        tracePaymentImport("field_mapped", mapped, {
                            rawKeys: Object.keys(raw).length,
                            phase: phase.label,
                        });
                    }
                    if (scopeToCustomer) {
                        const rowCustomer = String(
                            mapped.customer_number ?? ""
                        ).trim();
                        const rawRecord =
                            (mapped._rawRecord as
                                | Record<string, unknown>
                                | undefined) ?? raw;
                        const accname = String(
                            rawRecord.ACCNAME ?? ""
                        ).trim();
                        const idgCustname = String(
                            rawRecord.IDG_CUSTNAME ?? ""
                        ).trim();
                        const idcCustnameIv = String(
                            rawRecord.IDC_CUSTNAMEIV ?? ""
                        ).trim();
                        const inScope =
                            (rowCustomer.length > 0 &&
                                allowedCustomerNumbers.has(rowCustomer)) ||
                            (accname.length > 0 &&
                                allowedCustomerNumbers.has(accname)) ||
                            (idgCustname.length > 0 &&
                                allowedCustomerNumbers.has(idgCustname)) ||
                            (idcCustnameIv.length > 0 &&
                                allowedCustomerNumbers.has(idcCustnameIv));
                        if (!inScope) {
                            if (entityType === "Payment") {
                                tracePaymentImport("pull_skip_customer_scope", mapped, {
                                    rowCustomer,
                                    accname: accname || null,
                                    idgCustname: idgCustname || null,
                                    idcCustnameIv: idcCustnameIv || null,
                                    scopedCustomerNumber,
                                    allowedCustomerNumbers: [
                                        ...allowedCustomerNumbers,
                                    ],
                                    phase: phase.label,
                                });
                            }
                            continue;
                        }
                    }
                    mappedPage.push(mapped);
                }
                if (
                    entityType === "Payment" &&
                    phase.label.startsWith("idc_fallback") &&
                    idcFallbackDroppedIdg > 0
                ) {
                    log(
                        `[payment-watch] Payment idc_fallback dropped ${idcFallbackDroppedIdg} row(s) with non-empty IDG_CUSTNAME (client partition)`
                    );
                }

                bumpProcessedPage(stats, entityType, mappedPage.length);
                emitProgress();

                let pageRows: Record<string, unknown>[] = mappedPage;
                if (mappedPage.length > 0) {
                    try {
                        const afterPlugin = await options.extension.transform({
                            accountId: options.accountId,
                            window,
                            batch: { [entityType]: mappedPage },
                            extension_config: options.extensionConfig,
                            prisma: dryRun ? undefined : options.prisma,
                            userId: options.userId,
                            dryRun,
                            pendingInvoiceCloses,
                            pendingInvoiceCloseDates,
                        });
                        mergeBatch(previewBatch, afterPlugin);
                        mergeBatch(windowBatch, afterPlugin);
                        pageRows = afterPlugin[entityType] ?? [];
                        if (entityType === "Payment") {
                            for (const row of mappedPage) {
                                if (!isTracedPaymentRow(row)) {
                                    continue;
                                }
                                const raw =
                                    (row._rawRecord as
                                        | Record<string, unknown>
                                        | undefined) ?? row;
                                const fncnum = String(raw.FNCNUM ?? "").trim();
                                const stillPresent = pageRows.some((kept) => {
                                    const keptRaw =
                                        (kept._rawRecord as
                                            | Record<string, unknown>
                                            | undefined) ?? kept;
                                    return (
                                        String(keptRaw.FNCNUM ?? "").trim() ===
                                        fncnum
                                    );
                                });
                                if (!stillPresent) {
                                    tracePaymentImport(
                                        "extension_removed_from_page",
                                        row,
                                        {
                                            mappedPageCount: mappedPage.length,
                                            keptPageCount: pageRows.length,
                                        }
                                    );
                                }
                            }
                            for (const row of pageRows) {
                                if (isTracedPaymentRow(row)) {
                                    tracePaymentImport("import_batch_row", row, {
                                        batchSize: pageRows.length,
                                    });
                                }
                            }
                        }
                    } catch (err) {
                        const message =
                            err instanceof Error
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

                    // Preview accumulates post-plugin rows without entity writes.
                    if (!dryRun && pageRows.length > 0) {
                        setActiveStep(entityType, "importing");
                        const importResult = await importFn(
                            options.prisma,
                            entityType,
                            pageRows,
                            options.accountId,
                            null,
                            options.userId,
                            {
                                skipReportingBreach:
                                    options.skipReportingBreach === true,
                                skipDeferredPaymentMaturity:
                                    entityType === "Invoice",
                                onLog: options.onLog,
                                shouldCancel: options.shouldCancel,
                                extension: options.extension,
                            }
                        );
                        bumpImported(
                            stats,
                            entityType,
                            importResult.success,
                            importResult.failed
                        );
                        const cacheRows = rowsEnteringImport(
                            pageRows,
                            importResult
                        );
                        if (cacheRows.length > 0) {
                            const existing =
                                importCacheByEntity.get(entityType) ?? [];
                            existing.push(...cacheRows);
                            importCacheByEntity.set(entityType, existing);
                        }
                        windowImported += importResult.success;
                        windowErrors += importResult.failed;
                        if (
                            entityType === "Payment" ||
                            entityType === "Invoice"
                        ) {
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
                        if (importResult.failed > 0) {
                            const sampleErrors = importResult.errors
                                .slice(0, 3)
                                .join("; ");
                            entityLastError = sampleErrors || entityLastError;
                            log(
                                `${entityType} import had ${importResult.failed} failed row(s); continuing` +
                                    (sampleErrors
                                        ? ` — sample: ${sampleErrors}`
                                        : "")
                            );
                        }
                        emitProgress();

                        if (importResult.cancelled) {
                            await checkpointEntityPage({
                                prisma: options.prisma,
                                connectorId: options.connectorId,
                                entityType,
                                pulled: (stats as Record<string, number>)[
                                    processedKey(entityType)
                                ],
                                nextCursor: afterKey,
                                maxUpdated:
                                    pageRows.length > 0
                                        ? extractMaxUpdatedAt(pageRows)
                                        : null,
                                lastError: null,
                                pageComplete: false,
                                pageSize: entityPageSize,
                                providerTotalCount: page.totalCount,
                            });
                            log(
                                `Stopped by operator during ${entityType} import`
                            );
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
                        pulled: (stats as Record<string, number>)[
                            processedKey(entityType)
                        ],
                        nextCursor,
                        maxUpdated:
                            pageRows.length > 0
                                ? extractMaxUpdatedAt(pageRows)
                                : null,
                        lastError: entityLastError,
                        pageComplete: exhausted,
                        pageSize: entityPageSize,
                        providerTotalCount: page.totalCount,
                    });
                }

                if (exhausted) {
                    break;
                }
                afterKey = page.nextCursor;
            }

            if (entityType === "Payment") {
                log(
                    `[payment-watch] Payment ${phase.label} phase done watchedSeen=${watchedPaymentSeen} pendingCloses=${pendingInvoiceCloses.size}`
                );
            }
            }

            if (entityType === "Payment") {
                log(
                    `[payment-watch] Payment entity done watchedSeen=${watchedPaymentSeen} pendingCloses=${pendingInvoiceCloses.size} watchKeys=SI26BZ002069,26082866,4641`
                );
            }

            if (guard >= MAX_ENTITY_PAGES_PER_WINDOW && afterKey != null) {
                log(
                    `${entityType} hit page cap (${MAX_ENTITY_PAGES_PER_WINDOW} × ${entityPageSize}); more rows may remain — raise MAX_ENTITY_PAGES_PER_WINDOW`
                );
            }

            // Maturity once after all Invoice pages (not per page) so paging
            // stays fast; deferred payments from Payment-first ingest link here.
            if (!dryRun && entityType === "Invoice") {
                setActiveStep(MATURITY_ENTITY_STATS_KEY, "linking");
                paymentLink.paymentLinkStatus = "running";
                paymentLink.paymentLinkError = undefined;
                paymentLink.paymentsLinked = 0;
                paymentLink.paymentsStillDeferred = 0;
                paymentLink.paymentsLinkTotal = 0;
                emitProgress();
                try {
                    const maturityStarted = Date.now();
                    const maturityResult = await applyMaturedDeferredPayments(
                        options.prisma,
                        options.accountId,
                        new Date(),
                        undefined,
                        {
                            userId: options.userId,
                            onProgress: ({
                                linked,
                                totalCandidates,
                                detail,
                            }) => {
                                paymentLink.paymentLinkStatus = "running";
                                paymentLink.paymentsLinked = linked;
                                paymentLink.paymentsLinkTotal = totalCandidates;
                                paymentLink.paymentsStillDeferred = Math.max(
                                    0,
                                    totalCandidates - linked
                                );
                                paymentLink.paymentLinkDetail = detail;
                                emitProgress();
                            },
                        }
                    );
                    for (const id of maturityResult.affectedCustomerIds) {
                        arAffectedCustomerIds.add(id);
                    }
                    paymentLink.paymentLinkStatus = "done";
                    paymentLink.paymentLinkDetail = undefined;
                    paymentLink.paymentsLinked = maturityResult.matured;
                    paymentLink.paymentsStillDeferred =
                        maturityResult.deferredRemaining;
                    paymentLink.paymentsLinkTotal =
                        maturityResult.totalCandidates;
                    if (activeStep === MATURITY_ENTITY_STATS_KEY) {
                        activeStep = null;
                        activeStepDetail = null;
                    }
                    emitProgress();
                    log(
                        `Invoice entity maturity: ${maturityResult.matured} matured, ${maturityResult.deferredRemaining} still deferred in ${Date.now() - maturityStarted}ms`
                    );
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : "Deferred payment maturity failed";
                    paymentLink.paymentLinkStatus = "failed";
                    paymentLink.paymentLinkError = message;
                    if (activeStep === MATURITY_ENTITY_STATS_KEY) {
                        activeStep = null;
                        activeStepDetail = null;
                    }
                    emitProgress();
                    log(`Invoice entity maturity failed: ${message}`);
                }

                if (pendingInvoiceCloses.size > 0) {
                    await flushExtensionPendingCloses("after Invoice");
                }

                // Once after all Invoice pages + maturity, before Contact.
                invoicePostIngestRan = true;
                await runArTailWithProgress({
                    customerIds: Array.from(arAffectedCustomerIds),
                    invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                    paymentEntityIds: Array.from(arAffectedPaymentIds),
                    runMaturity: false,
                });
            }

            // Write once after the entity finishes all windows for this run.
            if (isLastWindow) {
                const cacheAbort = await flushEntityImportCacheOrAbort(
                    entityType
                );
                if (cacheAbort) {
                    return cacheAbort;
                }
            }
        }

        windows.push({
            window,
            ok: windowErrors === 0,
            batchAfterPlugin: windowBatch,
            imported: windowImported,
            importErrors: windowErrors,
            error:
                windowErrors > 0
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
        error:
            totalErrors > 0
                ? `${totalErrors} import error(s)`
                : undefined,
    });
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
