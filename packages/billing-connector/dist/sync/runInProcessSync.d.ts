import type { PrismaClient } from "@prisma/client";
import type { BillingProviderClient } from "../billing/BillingProviderClient";
import type { BillingAccountExtension, ExtensionMappedBatch, ExtensionSyncWindow } from "../extensions/types";
import { type ClearBeforeImportEntity } from "../purge/clearBeforeImport";
import { type ConnectorSyncProgressPatch } from "./connectorSyncRuntime";
import { type ImportBatchFn } from "./stagedExtensionSync";
import { type ArPostIngestHostFn, type ConnectorPostIngestDeferOptions } from "../credit/arPostIngestHost";
import { type ProcessOverdueCustomersFn } from "./processOverdueTailStep";
import { type BillingConnectorObservabilityOptions } from "../observability";
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
    resolveExtension?: (key: string) => BillingAccountExtension | undefined;
    /** Override importer (tests / dry-run verification). */
    importBatch?: ImportBatchFn;
    /** Progress lines for the host process terminal (Nest Logger, tests). */
    onLog?: (message: string) => void;
    /** Live pulled/imported counts for GET /sync-runs polling. */
    onProgress?: (patch: ConnectorSyncProgressPatch) => void;
    /**
     * After Payment/Invoice ingest (and deferred maturity), refresh denormalized
     * customer due/overdue amounts. Nest wires recalculateCustomerAmounts.
     */
    onCustomerBalancesFinal?: (customerIds: number[], options?: {
        onProgress?: (progress: {
            processed: number;
            total: number;
        }) => void;
    }) => Promise<void>;
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
    entity_stats?: Record<string, {
        pulled: number;
        success: number;
        failed: number;
        skipped: number;
    }>;
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
export declare function runInProcessSync(options: RunInProcessSyncOptions): Promise<RunInProcessSyncResult>;
