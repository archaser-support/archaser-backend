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
import { applyMaturedDeferredPayments } from "../import/applyMaturedDeferredPayments";
import { recalculateCustomerAmountsViaHost } from "../customers/recalculateCustomerAmountsHost";
import {
    BALANCES_ENTITY_STATS_KEY,
    PENDING_CLOSES_ENTITY_STATS_KEY,
    POST_INGEST_ENTITY_STATS_KEY,
    type TailStepKey,
    type TailStepDetail,
    type TailStepState,
} from "./connectorSyncRuntime";
import {
    invokeConnectorArPostIngest,
    type ArPostIngestHostFn,
    type ConnectorPostIngestDeferOptions,
} from "../credit/arPostIngestHost";
import {
    mapErpRecord,
    type MappingRule,
} from "../utils/connectorFieldUtils";
import { PRIORITY_RATE_LIMITS } from "../priority/priorityApiContract";
import { odataSelectFieldsFromMapping } from "../priority/prioritySelectFields";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveImportPullFilterOData } from "../services/billingConnectorPullFilters";

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
    onProgress?: (stats: RunStagedExtensionSyncResult["stats"]) => void;
    /** Cooperative cancel — checked between pages and after each import. */
    shouldCancel?: () => boolean;
    /**
     * After Payment/Invoice ingest + deferred maturity, refresh denormalized
     * customer due/overdue rollups for these customers (Nest wires
     * recalculateCustomerAmounts).
     */
    onCustomerBalancesFinal?: (customerIds: number[]) => Promise<void>;
    /**
     * After Invoice entity completes (all pages + maturity), or as payment-only
     * fallback when Invoice did not orchestrate, run shared AR post-ingest.
     * Nest wires the orchestrator; default host-require keeps the package free
     * of a hard Nest dependency.
     */
    onArPostIngest?: ArPostIngestHostFn;
    /**
     * Backfill cutover: Invoice/Payment $filter by created date (IVDATE/PAYDATE).
     * Customers and contacts still pull full history.
     */
    pullCreatedOnOrAfter?: boolean;
    /** Stored BillingConnector.pull_filters — applied on every live pull. */
    pullFilters?: unknown;
    /** Stored BillingConnector.entity_sets — overrides TOTARPAY / etc. */
    entitySets?: unknown;
    /** Per-entity mapping pull_date_field (admin pick). */
    dateFieldByType?: Map<string, string | null>;
    /** Incremental watermark overlap (minutes). */
    overlapMinutes?: number;
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
        paymentLinkStatus?: "running" | "done" | "failed";
        paymentsLinked?: number;
        paymentsStillDeferred?: number;
        paymentsLinkTotal?: number;
        paymentLinkError?: string;
        paymentLinkDetail?: TailStepDetail;
        tailSteps?: Partial<Record<TailStepKey, TailStepState>>;
    };
    cancelled?: boolean;
    error?: string;
    /**
     * True when Invoice entity finished and post-Invoice orchestration was
     * reached (even with zero customers). Used to skip payment-only fallback
     * so Payment→Invoice syncs do not double-run post-ingest.
     */
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
}): Promise<void> {
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
    const emitProgress = () =>
        options.onProgress?.({
            ...stats,
            ...paymentLink,
            tailSteps: { ...tailSteps },
        });
    const resultStats = () => ({
        ...stats,
        ...paymentLink,
        tailSteps: { ...tailSteps },
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
        emitProgress();
    };
    const cutover = options.pullCreatedOnOrAfter === true;
    const entitySets = parseEntitySetsMap(options.entitySets);
    const arAffectedCustomerIds = new Set<number>();
    const arAffectedInvoiceIds = new Set<number>();
    const arAffectedPaymentIds = new Set<number>();
    const paymentAffectedCustomerIds = new Set<number>();
    /** Recon debit IVNUMs queued during Payment transform for virtual close. */
    const pendingInvoiceCloses = new Set<string>();
    /** ERP CURDATE per queued IVNUM — payment date for its virtual close. */
    const pendingInvoiceCloseDates = new Map<string, Date>();
    /** Helam offset-pair invoice numbers (original + cancel) for stamp-close. */
    const pendingHelamOffsetCloses = new Set<string>();
    let invoicePostIngestRan = false;

    const flushExtensionPendingCloses = async (label: string) => {
        if (
            (pendingInvoiceCloses.size === 0 &&
                pendingHelamOffsetCloses.size === 0) ||
            !options.extension.flushPendingInvoiceCloses
        ) {
            return;
        }
        const pendingTotal =
            pendingInvoiceCloses.size + pendingHelamOffsetCloses.size;
        setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
            status: "running",
            total: pendingTotal,
        });
        try {
            const pendingNumbers = Array.from(pendingInvoiceCloses);
            const helamOffsetNumbers = Array.from(pendingHelamOffsetCloses);
            const flushResult =
                await options.extension.flushPendingInvoiceCloses({
                    prisma: options.prisma,
                    accountId: options.accountId,
                    userId: options.userId,
                    invoiceNumbers: pendingNumbers,
                    invoiceCloseDates: new Map(pendingInvoiceCloseDates),
                    helamOffsetInvoiceNumbers: helamOffsetNumbers,
                });
            for (const invoiceId of flushResult.closedIds) {
                arAffectedInvoiceIds.add(invoiceId);
            }
            for (const customerId of flushResult.customerIds ?? []) {
                arAffectedCustomerIds.add(customerId);
            }
            pendingInvoiceCloses.clear();
            pendingInvoiceCloseDates.clear();
            pendingHelamOffsetCloses.clear();
            log(
                `Extension pending invoice closes (${label}): ${flushResult.closedIds.length} settled (${pendingNumbers.length} virtual, ${helamOffsetNumbers.length} Helam offset)`
            );
            setTailStep(PENDING_CLOSES_ENTITY_STATS_KEY, {
                status: "done",
                processed: flushResult.closedIds.length,
                total: pendingTotal,
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

    /** Wraps post-ingest so the UI shows it instead of freezing on the last entity. */
    const runPostIngestWithProgress = async (args: {
        customerIds: number[];
        invoiceEntityIds: number[];
        paymentEntityIds: number[];
        runMaturity: boolean;
    }): Promise<void> => {
        setTailStep(POST_INGEST_ENTITY_STATS_KEY, {
            status: "running",
            total: args.customerIds.length,
        });
        try {
            const postIngest = await invokeConnectorArPostIngest({
                accountId: options.accountId,
                customerIds: args.customerIds,
                invoiceEntityIds: args.invoiceEntityIds,
                paymentEntityIds: args.paymentEntityIds,
                prisma: options.prisma,
                onArPostIngest: options.onArPostIngest,
                log,
                runMaturity: args.runMaturity,
                deferPostIngest: options.deferPostIngest,
                enqueueDeferredSteps: options.enqueueDeferredSteps,
                schedulePostIngestDrain: options.schedulePostIngestDrain,
                onProgress: ({ completed, total, step, detail }) => {
                    setTailStep(POST_INGEST_ENTITY_STATS_KEY, {
                        status: "running",
                        processed: completed,
                        total,
                        ...(step
                            ? { detail: { step, ...(detail ?? {}) } }
                            : {}),
                    });
                },
            });
            setTailStep(POST_INGEST_ENTITY_STATS_KEY, {
                status: postIngest.deferred ? "queued" : "done",
                processed: args.customerIds.length,
                total: args.customerIds.length,
            });
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "AR post-ingest failed";
            setTailStep(POST_INGEST_ENTITY_STATS_KEY, {
                status: "failed",
                total: args.customerIds.length,
                error: message,
            });
        }
    };

    const finishWithBalances = async (
        result: RunStagedExtensionSyncResult
    ): Promise<RunStagedExtensionSyncResult> => {
        if (!dryRun) {
            await flushExtensionPendingCloses("finalize");
            // Payment-only (or Invoice-not-orchestrated) fallback: same
            // orchestrator as post-Invoice, including deferred maturity.
            // Skip when Invoice already ran post-ingest in this sync.
            if (
                !result.cancelled &&
                !invoicePostIngestRan &&
                paymentAffectedCustomerIds.size > 0
            ) {
                await runPostIngestWithProgress({
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
        return { ...result, invoicePostIngestRan };
    };

    for (const window of options.windows) {
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
            let entityLastError: string | null = null;
            const entitySet = entitySets[entityType] ?? null;
            // Customer/Contact tables often lack a usable date column; scope via
            // pull_filters OData only. Invoice/Payment still use date windows.
            const usesDatePull =
                entityType === "Invoice" || entityType === "Payment";
            const applyDateWindow =
                Boolean(windowCutover) && usesDatePull;
            const entityPullFilter = resolveImportPullFilterOData(
                options.pullFilters,
                entityType
            );

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
                const page = await options.provider.pull(entityType, {
                    since: usesDatePull && !applyDateWindow ? window.start : null,
                    createdOnOrAfter: applyDateWindow ? windowCutover : null,
                    preferredDateField: usesDatePull
                        ? options.dateFieldByType?.get(entityType) ?? null
                        : null,
                    overlapMinutes: options.overlapMinutes,
                    afterKey,
                    pagination: "keyset",
                    pageSize: PRIORITY_RATE_LIMITS.recommendedPageSize,
                    entitySet,
                    filter: entityPullFilter,
                    select: odataSelectFieldsFromMapping({
                        mappingRules: rules,
                        extraFields: ["UDATE"],
                        entityType,
                    }),
                });

                const mappedPage: Record<string, unknown>[] = [];
                for (const raw of page.records) {
                    if (
                        usesDatePull &&
                        !windowCutover &&
                        !recordInWindow(raw, window)
                    ) {
                        continue;
                    }
                    mappedPage.push(mapErpRecord(raw, rules));
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
                            pendingHelamOffsetCloses,
                        });
                        mergeBatch(previewBatch, afterPlugin);
                        mergeBatch(windowBatch, afterPlugin);
                        pageRows = afterPlugin[entityType] ?? [];
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
                            entityLastError =
                                importResult.errors.slice(0, 3).join("; ") ||
                                entityLastError;
                            log(
                                `${entityType} import had ${importResult.failed} failed row(s); continuing`
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
                    emitProgress();
                    log(`Invoice entity maturity failed: ${message}`);
                }

                if (
                    pendingInvoiceCloses.size > 0 ||
                    pendingHelamOffsetCloses.size > 0
                ) {
                    await flushExtensionPendingCloses("after Invoice");
                }

                // Once after all Invoice pages + maturity, before Contact.
                invoicePostIngestRan = true;
                await runPostIngestWithProgress({
                    customerIds: Array.from(arAffectedCustomerIds),
                    invoiceEntityIds: Array.from(arAffectedInvoiceIds),
                    paymentEntityIds: Array.from(arAffectedPaymentIds),
                    runMaturity: false,
                });
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
