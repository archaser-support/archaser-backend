import { Prisma } from "@prisma/client";
import { FormulaAstNode } from "./parser";
export type FormulaNullReason = "missing_operand" | "div_by_zero" | "non_finite" | "error";
export type FormulaEvalResult = {
    value: Prisma.Decimal | null;
    nullReason?: FormulaNullReason;
};
export declare function evaluateFormulaAst(node: FormulaAstNode, getFieldValue: (reference: string) => unknown): FormulaEvalResult;
export declare function evaluateFormulaExpression(expression: string, getFieldValue: (reference: string) => unknown): FormulaEvalResult;
export declare function decimalToNumberOrNull(value: Prisma.Decimal | null): number | null;
