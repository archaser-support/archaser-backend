import type { PrismaClient } from "@prisma/client";
export type ImportEntityType = "Customer" | "Contact" | "Invoice" | "Payment";
export interface EntityImportBatchResult {
    success: number;
    failed: number;
    skipped: number;
    affectedCustomerIds: number[];
    errors: string[];
}
export declare function extractMaxUpdatedAt(records: Record<string, unknown>[]): Date | null;
/**
 * Prisma-native entity upsert for connector sync (Priority deepen).
 * Does not depend on monolith Import* service graph.
 */
export declare function importMappedEntityBatch(prisma: PrismaClient, importType: ImportEntityType, records: Record<string, unknown>[], accountId: number, mappingJson: unknown, userId?: string): Promise<EntityImportBatchResult>;
export declare function updateAccountLastSyncDate(prisma: PrismaClient, accountId: number, syncedAt?: Date): Promise<void>;
