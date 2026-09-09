export type FormulaResultFormat =
    | "number"
    | "currency"
    | "percentage"
    | "yes_no";

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

/**
 * Pseudo filter-table name for formula columns in report filter rows.
 * Matches the frontend Formulas object picker (`__formulas__`).
 */
export const FORMULA_FILTER_TABLE = "__formulas__";

export function getFormulaOutputKey(formulaId: string): string {
    return `${FORMULA_OUTPUT_KEY_PREFIX}${formulaId}`;
}

export function isFormulaOutputKey(key: string): boolean {
    return key.startsWith(FORMULA_OUTPUT_KEY_PREFIX);
}

export function isFormulaFilterField(
    field: string | undefined | null
): boolean {
    return typeof field === "string" && isFormulaOutputKey(field);
}

export interface FormulaWarningSummary {
    formulaId: string;
    label: string;
    invalidCount: number;
}
