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
/**
 * Customer $filter that is safe to AND onto Invoice / Payment / Contact.
 * Those entities share CUSTNAME; customer-only fields (CDES, …) would 400.
 */
export declare function resolveRelatedCustomerPullFilterOData(raw: unknown): string | null;
/**
 * OData $filter for a live import pull: the entity's own pull filter, plus a
 * CUSTNAME-only Customer filter on related entities so invoices/payments/
 * contacts stay inside the same customer subset.
 *
 * Optional Start-backfill `runtimeCustomerNumber` is AND-ed with the entity's
 * ERP customer column (`IDG_CUSTNAME` on IDG_ARFNCITEMS* payment tables,
 * otherwise `CUSTNAME`) so customer-scoped pulls do not page the full table.
 */
export declare function resolveImportPullFilterOData(raw: unknown, importType: ImportType, options?: {
    runtimeCustomerNumber?: string | null;
    /** Extra values OR'd into the runtime customer-scope clause. */
    additionalCustomerNumbers?: string[] | null;
    entitySet?: string | null;
}): string | null;
/**
 * ERP customer-number $filter for Start backfill customer scope.
 * IDG payment tables (e.g. IDG_ARFNCITEMS4) use IDG_CUSTNAME; standard
 * Priority Customer/Contact/Invoice/Payment sets use CUSTNAME.
 *
 * When `additionalCustomerNumbers` is set (account extensions), builds
 * `(field eq 'A' or field eq 'B' or …)`.
 */
export declare function resolveRuntimeCustomerScopeOData(params: {
    customerNumber: string | null | undefined;
    additionalCustomerNumbers?: string[] | null;
    entityType: ImportType;
    entitySet?: string | null;
}): string | null;
/**
 * @deprecated Prefer {@link resolveRuntimeCustomerScopeOData} with entityType /
 * entitySet so IDG payment tables filter on IDG_CUSTNAME.
 */
export declare function compileRuntimeCustomerNumberOData(customerNumber: string | null | undefined, entityType?: ImportType, entitySet?: string | null): string | null;
