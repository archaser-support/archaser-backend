import type { ImportType, Prisma } from "@prisma/client";
export type EntitySetsMap = Partial<Record<ImportType, string>>;
/**
 * Normalize one entity-set name. Empty / whitespace → clear (use contract default).
 */
export declare function normalizeEntitySetName(value: unknown): string | null | undefined;
export declare function parseEntitySetsMap(raw: unknown): EntitySetsMap;
/**
 * Merge a partial patch into existing entity_sets.
 * Per-entity `null` or `""` clears that override.
 */
export declare function mergeEntitySetsPatch(existing: unknown, patch: Partial<Record<ImportType, string | null>> | undefined): EntitySetsMap;
export declare function entitySetsToPrismaJson(map: EntitySetsMap): Prisma.InputJsonValue;
export declare function resolveEntityCollectionPath(importType: ImportType, entitySets?: EntitySetsMap | null): string;
export declare function parseEntitySetCatalog(raw: unknown): string[];
export declare function entitySetCatalogToPrismaJson(names: string[]): Prisma.InputJsonValue;
/** Import types whose entity-set override string changed. */
export declare function listChangedEntitySetEntities(params: {
    existing: unknown;
    next: EntitySetsMap;
}): ImportType[];
export declare function getDefaultEntitySets(): Partial<Record<ImportType, string>>;
