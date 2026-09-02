export type PullFilterOperator = "eq" | "ne" | "startswith" | "contains" | "gt" | "lt";
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
export declare function andODataFilters(...parts: Array<string | null | undefined>): string | null;
export declare function escapeODataStringLiteral(value: string): string;
/**
 * Compile stored entity filter to OData $filter text.
 * Rules AND together. Advanced mode returns the stored expression as-is.
 */
export declare function compileEntityPullFilter(config: EntityPullFilterConfig | null | undefined): string | null;
