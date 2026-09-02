export type FormulaResultFormat = "number" | "currency" | "percentage";
export type FormulaAggregation = "SUM" | "AVG" | "MIN" | "MAX";
export declare const MAX_FORMULAS_PER_REPORT = 10;
export declare const MAX_FORMULA_EXPRESSION_LENGTH = 500;
export declare const MAX_FORMULA_AST_DEPTH = 10;
export interface ReportFormula {
    id: string;
    label: string;
    expression: string;
    format: FormulaResultFormat;
    currencySource?: string;
    aggregation?: FormulaAggregation;
}
export declare const FORMULA_OUTPUT_KEY_PREFIX = "formula:";
export declare function getFormulaOutputKey(formulaId: string): string;
export interface FormulaWarningSummary {
    formulaId: string;
    label: string;
    invalidCount: number;
}
