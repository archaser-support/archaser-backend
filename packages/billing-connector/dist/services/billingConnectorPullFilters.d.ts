import type { ImportType, Prisma } from "@prisma/client";
export type PullFilterOperator = "eq" | "ne" | "startswith" | "contains" | "gt" | "lt";
export declare const PULL_FILTER_OPERATORS: PullFilterOperator[];
export interface PullFilterRule {
    field: string;
    operator: PullFilterOperator;
    value: string;
}
export interface AdvancedEntityPullFilter {
    mode: "advanced";
    odata: string;
}
export interface RulesEntityPullFilter {
    mode: "rules";
    rules: PullFilterRule[];
}
export type EntityPullFilterConfig = AdvancedEntityPullFilter | RulesEntityPullFilter;
export type PullFiltersMap = Partial<Record<ImportType, EntityPullFilterConfig | null>>;
export declare function parsePullFiltersMap(raw: unknown): PullFiltersMap;
export declare function mergePullFiltersPatch(existing: unknown, patch: PullFiltersMap | undefined): PullFiltersMap;
export declare function pullFiltersToPrismaJson(map: PullFiltersMap): Prisma.InputJsonValue;
export declare function listChangedPullFilterEntities(params: {
    existing: unknown;
    next: PullFiltersMap;
}): ImportType[];
export declare function toPublicPullFilters(raw: unknown): {
    pull_filters: PullFiltersMap;
    effective_pull_filters: Partial<Record<ImportType, string | null>>;
};
export declare function resolveEntityPullFilterOData(raw: unknown, importType: ImportType): string | null;
