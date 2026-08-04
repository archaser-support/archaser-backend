/**
 * Build CSV export bytes from report execute JSON rows.
 */
export declare function rowsToCsv(rows: Record<string, unknown>[]): string;
export type ReportExportFormat = "csv" | "excel" | "pdf";
export type ReportExportPayload = {
    format: ReportExportFormat;
    filename: string;
    contentBase64: string;
    contentType: string;
};
export declare function buildReportExport(rows: Record<string, unknown>[], reportName: string, format: ReportExportFormat): ReportExportPayload;
