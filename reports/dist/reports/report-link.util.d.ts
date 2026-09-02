/**
 * Leaves-parity link metadata for report grid cells.
 * UI (viewColumnGenerator) expects `__link_<key>` = `{ type, id, tab? }`.
 */
export type ReportLinkMetadata = {
    type: string;
    id: number | string;
    tab?: string;
};
export type ReportFieldRef = {
    table: string;
    field: string;
    alias?: string;
};
export declare function resolveCustomerIdForLink(row: Record<string, unknown>, primaryTable: string): number | string | undefined;
export declare function resolveParentCustomerIdForLink(row: Record<string, unknown>): number | string | undefined;
/**
 * Decide whether a report field cell should be clickable, matching leaves
 * ReportExecutionService.getFieldLinkMetadata.
 */
export declare function getFieldLinkMetadata(fieldConfig: ReportFieldRef, row: Record<string, unknown>, primaryTable: string, outputKey: string): ReportLinkMetadata | null;
/** Flat linking FKs always attached to formatted rows (leaves parity). */
export declare function attachLinkingIds(out: Record<string, unknown>, row: Record<string, unknown>, primaryTable: string, tablesInReport: string[]): void;
