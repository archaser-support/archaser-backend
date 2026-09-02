import { FormulaWarningSummary, ReportFormula } from "./types";
export type FormulaField = {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
};
export type FormulaReportConfig = {
    tables?: string[];
    fields?: FormulaField[];
    formulas?: ReportFormula[];
};
export type FormulaMetadataTable = {
    name: string;
    fields: Array<{
        name: string;
        type: string;
    }>;
};
export declare function mergeFormulaOperandFieldsIntoConfig<T extends FormulaReportConfig>(config: T, metadataTables: FormulaMetadataTable[]): T;
export declare function applyFormulasToRows(rows: Record<string, unknown>[], config: FormulaReportConfig, options: {
    locale?: string;
    accountCurrency?: string;
    metadataTables: FormulaMetadataTable[];
}): {
    rows: Record<string, unknown>[];
    warnings: FormulaWarningSummary[];
};
