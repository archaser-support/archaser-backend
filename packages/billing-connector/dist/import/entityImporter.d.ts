import type { PrismaClient } from "@prisma/client";
export type ImportEntityType = "Customer" | "Contact" | "Invoice" | "Payment";
export interface EntityImportRowResult {
    index: number;
    success: boolean;
    skipped?: boolean;
    error?: string;
    entityId?: number;
    customerId?: number;
}
export interface EntityImportBatchResult {
    success: number;
    failed: number;
    skipped: number;
    affectedCustomerIds: number[];
    entityIds: number[];
    errors: string[];
    cancelled?: boolean;
    rowResults?: EntityImportRowResult[];
}
export interface EntityImportBatchOptions {
    skipReportingBreach?: boolean;
    onLog?: (message: string) => void;
    shouldCancel?: () => boolean;
}
export declare function shouldSkipReportingBreachOnConnectorWrite(params: {
    syncMode: "BACKFILL" | "INCREMENTAL" | "backfill" | "incremental";
    skipReportingBreachOnBackfill: boolean;
}): boolean;
export declare function extractMaxUpdatedAt(records: Record<string, unknown>[]): Date | null;
/**
 * Prisma-native entity upsert for connector sync and manual import.
 */
export declare function importMappedEntityBatch(prisma: PrismaClient, importType: ImportEntityType, records: Record<string, unknown>[], accountId: number, mappingJson: unknown, userId?: string, options?: EntityImportBatchOptions): Promise<EntityImportBatchResult>;
export declare function updateAccountLastSyncDate(prisma: PrismaClient, accountId: number, syncedAt?: Date): Promise<void>;
