export type FormulaParseErrorCode = "empty_expression" | "expression_too_long" | "unexpected_character" | "unclosed_parenthesis" | "unclosed_reference" | "invalid_reference" | "missing_operand" | "overflow" | "prohibited_token";
export declare class FormulaParseError extends Error {
    readonly code: FormulaParseErrorCode;
    constructor(code: FormulaParseErrorCode, message: string);
}
export type FormulaAstNode = {
    type: "number";
    value: string;
} | {
    type: "field";
    reference: string;
} | {
    type: "unary";
    operator: "+" | "-";
    operand: FormulaAstNode;
} | {
    type: "binary";
    operator: "+" | "-" | "*" | "/";
    left: FormulaAstNode;
    right: FormulaAstNode;
};
export declare function isFormulaOperandReference(reference: string): boolean;
export declare function getFormulaIdFromOperandReference(reference: string): string | null;
export declare function extractFieldReferences(expression: string): string[];
export declare function normalizeFormulaExpression(expression: string, decimalSeparator?: "." | ","): string;
export declare function parseFormulaExpression(expression: string): FormulaAstNode;
