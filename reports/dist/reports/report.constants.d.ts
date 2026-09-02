/** Report metadata table name → Prisma client delegate key. */
export declare const MODEL_NAME_MAP: Record<string, string>;
/** Context → primary report table for entity-list execute. */
export declare const CONTEXT_PRIMARY_TABLE: Record<string, string>;
/**
 * Embedded entity grids (customer detail tabs, etc.) that must execute without
 * requiring the global `view_reports` permission.
 */
export declare const ENTITY_LIST_REPORT_CONTEXTS: Set<string>;
export declare const DASHBOARD_REPORT_CONTEXTS: Set<string>;
export declare const FINANCIAL_DASHBOARD_CONTEXTS: Set<string>;
export declare const OPERATION_DASHBOARD_CONTEXTS: Set<string>;
export declare const CREDIT_DASHBOARD_CONTEXTS: Set<string>;
/** Prisma relation name on primary model for nested table fields. */
export declare const RELATION_FROM_PRIMARY: Record<string, Record<string, string>>;
export declare function getFieldOutputKey(field: {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
}): string;
