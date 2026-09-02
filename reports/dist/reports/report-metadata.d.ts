/**
 * Report metadata structure matching the metadata API
 * This file contains static metadata definitions for report tables and fields
 */
export interface TableMetadata {
    name: string;
    label: string;
    fields: FieldMetadata[];
    /** When true, table is hidden from the report builder table picker (e.g. relation/lookup tables). */
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
