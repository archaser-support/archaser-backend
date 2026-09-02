/**
 * Virtual Customer fields resolved from the latest CustomerPolicyTrend snapshot.
 * Port of frontend reportCustomerTrendCostFields (subset needed by credit dashboards).
 */
export declare const TREND_COST_BACKED_REPORT_FIELDS: Set<string>;
export declare function isTrendCostBackedReportField(field: string): boolean;
export declare function getLatestCustomerPolicyTrendRow(row: unknown): Record<string, unknown> | null;
export declare function extractTrendCostReportField(row: unknown, field: string): unknown;
export declare function mergeLatestCustomerPolicyTrendSelect(select: Record<string, unknown>, fields: string[]): void;
