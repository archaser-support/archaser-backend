import type { ImportType } from "@prisma/client";
export type ConnectorFieldTransform = "date" | "boolean" | "trim" | "currency_code";
export interface MappingRule {
    archaserField: string;
    erpField: string;
    transform?: ConnectorFieldTransform;
    defaultValue?: string;
}
export declare function getImportEntityFieldCatalog(importType: ImportType): {
    fields: string[];
    requiredFields: string[];
    highlightedFields: string[];
} | null;
export declare function isConnectorFieldTransform(value: unknown): value is ConnectorFieldTransform;
export declare function parseMappingRules(raw: unknown): MappingRule[];
export declare function isEmptyMappedValue(value: unknown): boolean;
export declare function extractNestedValue(obj: Record<string, unknown>, path: string): unknown;
/**
 * Take only the calendar date from an ERP datetime (YYYY-MM-DD as received).
 * Avoids timezone day-shifts from converting via toISOString().
 */
export declare function toErpDateOnly(value: unknown): string;
/** Parse ERP date/datetime to UTC midnight for Prisma `@db.Date` columns. */
export declare function parseErpDateOnly(value: unknown): Date | null;
export declare function applyConnectorTransform(value: unknown, transform?: ConnectorFieldTransform): unknown;
export declare function mapErpRecord(erpRecord: Record<string, unknown>, rules: MappingRule[]): Record<string, unknown>;
export declare function flattenObjectPaths(obj: Record<string, unknown>, prefix?: string, maxDepth?: number): {
    paths: string[];
    exampleValues: Record<string, unknown>;
};
export declare function discoverFieldPathsFromRecords(records: Record<string, unknown>[]): {
    rawHeaders: string[];
    exampleValues: Record<string, unknown>;
};
export declare function buildDefaultMappingRules(importType: ImportType): MappingRule[];
export declare function autoMapConnectorRules(importType: ImportType, rawHeaders: string[], existingRules?: MappingRule[]): MappingRule[];
export declare function validateMappedRow(importType: ImportType, row: Record<string, unknown>, rowIndex: number): string[];
export declare function computeMappingCompleteness(importType: ImportType, rules: MappingRule[]): boolean;
export declare function rulesToRecordMapping(rules: MappingRule[]): Record<string, {
    erpField: string;
    transform?: ConnectorFieldTransform;
}>;
