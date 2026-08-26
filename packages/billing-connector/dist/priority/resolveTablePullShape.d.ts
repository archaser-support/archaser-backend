export declare const ORDER_BY_FALLBACKS: readonly ["FNCNUM", "IVNUM", "PAYNUM", "CUSTNAME"];
export declare const DATE_FIELD_FALLBACKS: readonly ["FNCDATE", "PAYDATE", "IVDATE", "BALDATE", "UDATE"];
export declare function columnNameSet(headers: readonly string[]): Set<string>;
export declare function pickOrderByField(defaultOrderBy: string, columns: Set<string>): string;
export declare function pickDateField(preferred: string | null | undefined, columns: Set<string>): string | null;
export declare function intersectSelectFields(requested: readonly string[], columns: Set<string>, required: readonly string[]): string[];
export declare function odataFilterFieldNames(filter: string | null | undefined): string[];
export declare function assertFilterFieldsExist(filter: string | null | undefined, columns: Set<string>): void;
export declare function columnNamesFromRecords(records: Record<string, unknown>[]): string[];
