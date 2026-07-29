export type FormulaResultFormat = "number" | "currency" | "percentage";

export type FormulaAggregation = "SUM" | "AVG" | "MIN" | "MAX";

export const MAX_FORMULAS_PER_REPORT = 10;
export const MAX_FORMULA_EXPRESSION_LENGTH = 500;
export const MAX_FORMULA_AST_DEPTH = 10;

export interface ReportFormula {
    id: string;
    label: string;
    expression: string;
    format: FormulaResultFormat;
    currencySource?: string;
    aggregation?: FormulaAggregation;
}

export const FORMULA_OUTPUT_KEY_PREFIX = "formula:";

export function getFormulaOutputKey(formulaId: string): string {
    return `${FORMULA_OUTPUT_KEY_PREFIX}${formulaId}`;
}

export interface FormulaWarningSummary {
    formulaId: string;
    label: string;
    invalidCount: number;
}
