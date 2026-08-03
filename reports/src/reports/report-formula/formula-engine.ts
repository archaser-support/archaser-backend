import { Prisma } from "@prisma/client";
import { FormulaAstNode, parseFormulaExpression } from "./parser";

export type FormulaNullReason =
    | "missing_operand"
    | "div_by_zero"
    | "non_finite"
    | "error";

export type FormulaEvalResult = {
    value: Prisma.Decimal | null;
    nullReason?: FormulaNullReason;
};

const AUTO_SCALE_PERCENT_FIELDS = new Set([
    "cost_percent",
    "registration_fee_percent",
]);

function shouldAutoScalePercent(reference: string): boolean {
    const dot = reference.indexOf(".");
    const fieldName = dot >= 0 ? reference.slice(dot + 1) : reference;
    return AUTO_SCALE_PERCENT_FIELDS.has(fieldName);
}

function nullResult(reason: FormulaNullReason): FormulaEvalResult {
    return { value: null, nullReason: reason };
}

function valueResult(value: Prisma.Decimal): FormulaEvalResult {
    return { value };
}

function coerceToDecimal(value: unknown): Prisma.Decimal | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (value instanceof Prisma.Decimal) {
        return value.isFinite() ? value : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? new Prisma.Decimal(value) : null;
    }
    if (typeof value === "object" && "toNumber" in value) {
        try {
            const numberValue = (
                value as { toNumber: () => number }
            ).toNumber();
            return Number.isFinite(numberValue)
                ? new Prisma.Decimal(numberValue)
                : null;
        } catch {
            return null;
        }
    }
    try {
        const decimal = new Prisma.Decimal(String(value).trim());
        return decimal.isFinite() ? decimal : null;
    } catch {
        return null;
    }
}

export function evaluateFormulaAst(
    node: FormulaAstNode,
    getFieldValue: (reference: string) => unknown
): FormulaEvalResult {
    if (node.type === "number") {
        try {
            const decimal = new Prisma.Decimal(node.value);
            return decimal.isFinite()
                ? valueResult(decimal)
                : nullResult("non_finite");
        } catch {
            return nullResult("error");
        }
    }
    if (node.type === "field") {
        const value = coerceToDecimal(getFieldValue(node.reference));
        if (value === null) {
            return nullResult("missing_operand");
        }
        if (shouldAutoScalePercent(node.reference)) {
            const scaled = value.div(100);
            return scaled.isFinite()
                ? valueResult(scaled)
                : nullResult("non_finite");
        }
        return valueResult(value);
    }
    if (node.type === "unary") {
        const operand = evaluateFormulaAst(node.operand, getFieldValue);
        if (operand.value === null) {
            return nullResult(operand.nullReason || "error");
        }
        return valueResult(
            node.operator === "-" ? operand.value.neg() : operand.value
        );
    }

    const left = evaluateFormulaAst(node.left, getFieldValue);
    const right = evaluateFormulaAst(node.right, getFieldValue);
    if (left.value === null || right.value === null) {
        if (
            left.nullReason === "missing_operand" ||
            right.nullReason === "missing_operand"
        ) {
            return nullResult("missing_operand");
        }
        return nullResult(left.nullReason || right.nullReason || "error");
    }

    try {
        let result: Prisma.Decimal;
        switch (node.operator) {
            case "+":
                result = left.value.add(right.value);
                break;
            case "-":
                result = left.value.sub(right.value);
                break;
            case "*":
                result = left.value.mul(right.value);
                break;
            case "/":
                if (right.value.isZero()) {
                    return nullResult("div_by_zero");
                }
                result = left.value.div(right.value);
                break;
        }
        return result.isFinite()
            ? valueResult(result)
            : nullResult("non_finite");
    } catch {
        return nullResult("error");
    }
}

export function evaluateFormulaExpression(
    expression: string,
    getFieldValue: (reference: string) => unknown
): FormulaEvalResult {
    return evaluateFormulaAst(
        parseFormulaExpression(expression),
        getFieldValue
    );
}

export function decimalToNumberOrNull(
    value: Prisma.Decimal | null
): number | null {
    if (value === null) {
        return null;
    }
    try {
        const numberValue = value.toNumber();
        return Number.isFinite(numberValue) ? numberValue : null;
    } catch {
        return null;
    }
}
