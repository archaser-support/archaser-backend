export declare const MODEL_NAME_MAP: Record<string, string>;
export declare const CONTEXT_PRIMARY_TABLE: Record<string, string>;
export declare const DASHBOARD_REPORT_CONTEXTS: Set<string>;
export declare const FINANCIAL_DASHBOARD_CONTEXTS: Set<string>;
export declare const OPERATION_DASHBOARD_CONTEXTS: Set<string>;
export declare const CREDIT_DASHBOARD_CONTEXTS: Set<string>;
export declare const RELATION_FROM_PRIMARY: Record<string, Record<string, string>>;
export declare function getFieldOutputKey(field: {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
}): string;
