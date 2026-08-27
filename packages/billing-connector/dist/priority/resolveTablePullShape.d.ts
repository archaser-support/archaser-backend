export declare const ORDER_BY_FALLBACKS: readonly ["FNCNUM", "IVNUM", "PAYNUM", "CUSTNAME"];
export declare const DATE_FIELD_FALLBACKS: readonly ["FNCDATE", "PAYDATE", "IVDATE", "BALDATE", "UDATE"];
/**
 * Secondary sort for keyset pagination when the primary order-by is not unique
 * (e.g. IDG_ARFNCITEMS4: many KLINE rows share one FNCNUM).
 */
export declare const KEYSET_TIE_BREAKER_FIELDS: readonly ["KLINE"];
export declare function columnNameSet(headers: readonly string[]): Set<string>;
export declare function pickOrderByField(defaultOrderBy: string, columns: Set<string>): string;
/** Prefer KLINE when present and not already the primary order-by. */
export declare function pickKeysetTieBreaker(columns: Set<string>, primaryOrderBy: string): string | null;
export declare function encodeKeysetCursor(primary: string, secondary?: string | null): string;
export declare function parseKeysetCursor(afterKey: string): {
    primary: string;
    secondary: string | null;
};
/**
 * Keyset filter after `afterKey`.
 * With a tie-breaker and composite cursor `primary|secondary`:
 *   (orderBy gt primary) or ((orderBy eq primary) and (tieBreaker gt secondary))
 * Legacy single-field cursors keep `orderBy gt primary`.
 */
export declare function buildKeysetFilter(orderBy: string, afterKey: string, tieBreaker: string | null): string;
export declare function formatOrderByClause(orderBy: string, tieBreaker: string | null): string;
export declare function pickDateField(preferred: string | null | undefined, columns: Set<string>): string | null;
export declare function intersectSelectFields(requested: readonly string[], columns: Set<string>, required: readonly string[]): string[];
export declare function odataFilterFieldNames(filter: string | null | undefined): string[];
export declare function assertFilterFieldsExist(filter: string | null | undefined, columns: Set<string>): void;
export declare function columnNamesFromRecords(records: Record<string, unknown>[]): string[];
