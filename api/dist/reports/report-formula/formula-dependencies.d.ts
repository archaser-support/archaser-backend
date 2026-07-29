import { ReportFormula } from "./types";
export declare function getDirectFormulaDependencyIds(expression: string): string[];
export declare function getDirectFieldReferences(expression: string): string[];
export declare function buildFormulaDependencyMap(formulas: ReportFormula[]): Map<string, string[]>;
export type FormulaGraphError = {
    code: "unknown_formula";
    formulaId: string;
    missingId: string;
} | {
    code: "self_reference";
    formulaId: string;
} | {
    code: "cycle";
    formulaId: string;
    path: string[];
} | {
    code: "no_transitive_field";
    formulaId: string;
};
export declare function validateFormulaDependencyGraph(formulas: ReportFormula[]): FormulaGraphError | null;
export declare function topologicalSortFormulas(formulas: ReportFormula[]): ReportFormula[];
