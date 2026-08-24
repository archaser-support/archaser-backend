import type { PrismaClient } from "@prisma/client";
import type { BillingProviderClient } from "../billing/BillingProviderClient";
import type { BillingAccountExtension, ExtensionEntityType, ExtensionMappedBatch, ExtensionSyncWindow } from "../extensions/types";
import { type EntityImportBatchOptions, type EntityImportBatchResult, type ImportEntityType } from "../import/entityImporter";
import { type MappingRule } from "../utils/connectorFieldUtils";
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
/**
 * Staged path: for each time/date window, pull+map all enabled entities,
 * run the extension plugin once, then persist in platform entity order.
 * Plugin failure fails the current window only; prior windows stay imported.
 * Never falls back to importing pre-plugin mapped rows.
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
