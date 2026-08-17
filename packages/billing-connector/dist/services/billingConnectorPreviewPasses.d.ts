import type { ImportType, Prisma } from "@prisma/client";
export interface EntityPreviewPass {
    passed: boolean;
    completed_at: string;
}
export type PreviewPassesMap = Partial<Record<ImportType, EntityPreviewPass>>;
export declare function parsePreviewPassesMap(raw: unknown): PreviewPassesMap;
export declare function previewPassesToPrismaJson(map: PreviewPassesMap): Prisma.InputJsonValue;
export declare function clearPreviewPass(existing: unknown, importType: ImportType): PreviewPassesMap;
export declare function clearPreviewPasses(existing: unknown, importTypes: ImportType[]): PreviewPassesMap;
export declare function setPreviewPass(existing: unknown, importType: ImportType, passed: boolean, completedAt?: Date): PreviewPassesMap;
export declare function setPreviewPasses(existing: unknown, updates: Array<{
    importType: ImportType;
    passed: boolean;
}>, completedAt?: Date): PreviewPassesMap;
/**
 * True when every enabled entity has a stored passing preview.
 */
export declare function allEnabledEntitiesPreviewPassed(enabledEntities: ImportType[], previewPasses: unknown): boolean;
/**
 * Entity-level pass from one preview entity result (ignores global cutover info checks).
 */
export declare function computeEntityPreviewPassed(entity: {
    validation_errors: string[];
    sample_rows: unknown[];
    sorted_preview: boolean;
    import_type: ImportType;
}): boolean;
