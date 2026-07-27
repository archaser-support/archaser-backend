export interface TableMetadata {
    name: string;
    label: string;
    fields: FieldMetadata[];
    hidden?: boolean;
}
export interface FieldMetadata {
    name: string;
    type: string;
    label: string;
    options?: string[];
    translationKey?: string;
    translationNamespace?: string;
    enumValueKeyPrefix?: string;
}
export declare const REPORT_METADATA: {
    tables: TableMetadata[];
};
