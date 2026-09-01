import type { PrismaClient } from "@prisma/client";
import type { BillingProviderClient } from "../billing/BillingProviderClient";
import type { BillingAccountExtension, ExtensionEntityType, ExtensionMappedBatch, ExtensionSyncWindow } from "../extensions/types";
import { type EntityImportBatchOptions, type EntityImportBatchResult, type ImportEntityType } from "../import/entityImporter";
import { type ArPostIngestHostFn, type ConnectorPostIngestDeferOptions } from "../credit/arPostIngestHost";
import { type MappingRule } from "../utils/connectorFieldUtils";
import { type TailStepKey, type TailStepDetail, type TailStepState } from "./connectorSyncRuntime";
export declare const STAGED_ENTITY_ORDER: ExtensionEntityType[];
export type ImportBatchFn = (prisma: PrismaClient, importType: ImportEntityType, records: Record<string, unknown>[], accountId: number, mappingJson: unknown, userId?: string, options?: EntityImportBatchOptions) => Promise<EntityImportBatchResult>;
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
/**
 * Staged path: for each window and entity, pull one page, run the extension
 * plugin on that page, then upsert immediately. Row-level import failures are
 * counted and checkpointed (`last_error`) but do not abort remaining pages,
 * entities, or windows. Never falls back to importing pre-plugin rows.
 */
export declare function runStagedExtensionSync(options: RunStagedExtensionSyncOptions): Promise<RunStagedExtensionSyncResult>;
/**
 * Default window plan: one open window from the earliest watermark (or null)
 * through end (typically "now"). Callers may pass explicit windows for
 * multi-window backfills / tests.
 */
export declare function planDefaultSyncWindows(params: {
    earliestWatermark: Date | null;
    end?: Date;
}): ExtensionSyncWindow[];
