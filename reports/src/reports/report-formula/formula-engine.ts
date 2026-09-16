import { Prisma } from "@prisma/client";
import {
    getUtcCalendarDayKey,
    getUtcMidnightMs,
    parseIsoDateLiteral,
    parseReportDateValue,
} from "../report-datetime.util";
import {
    FormulaAstNode,
    FormulaCompareOperator,
    isFormulaCompareOperator,
    parseFormulaExpression,
} from "./parser";

export type FormulaNullReason =
    | "missing_operand"
    | "div_by_zero"
    | "non_finite"
    | "error";

export type FormulaEvalResult = {
    value: Prisma.Decimal | null;
    nullReason?: FormulaNullReason;
};

export type FormulaFieldTypeResolver = (
    reference: string
) => string | undefined;

const AUTO_SCALE_PERCENT_FIELDS = new Set([
    "cost_percent",
    "registration_fee_percent",
]);

type DateLikeKind = "date" | "datetime" | "date_literal";

type ResolvedDateLike =
    | { ok: true; kind: DateLikeKind; date: Date }
    | { ok: false; reason: FormulaNullReason };

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

function normalizeFieldType(type?: string): string {
    return (type || "").toLowerCase();
}

function isDateTimeFieldType(type?: string): boolean {
    return normalizeFieldType(type) === "datetime";
}

function isDateLikeFieldType(type?: string): boolean {
    const normalized = normalizeFieldType(type);
    return normalized === "date" || normalized === "datetime";
}

function applyCompare(
    cmp: number,
    operator: FormulaCompareOperator
): boolean {
    switch (operator) {
        case "=":
            return cmp === 0;
        case "!=":
            return cmp !== 0;
        case "<":
            return cmp < 0;
        case ">":
            return cmp > 0;
        case "<=":
            return cmp <= 0;
        case ">=":
            return cmp >= 0;
        default:
            return false;
    }
}

function compareCalendarDays(
    left: Date,
    right: Date,
    operator: FormulaCompareOperator
): boolean {
    const leftKey = getUtcCalendarDayKey(left);
    const rightKey = getUtcCalendarDayKey(right);
    const cmp = leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    return applyCompare(cmp, operator);
}

function compareInstants(
    leftMs: number,
    rightMs: number,
    operator: FormulaCompareOperator
): boolean {
    const cmp = leftMs < rightMs ? -1 : leftMs > rightMs ? 1 : 0;
    return applyCompare(cmp, operator);
}

/** Direct date/datetime field or ISO date literal — only valid as compare operands. */
function isDateLikeCompareOperand(
    node: FormulaAstNode,
    getFieldType?: FormulaFieldTypeResolver
): boolean {
    if (node.type === "date_literal") {
        return true;
    }
    if (node.type === "field") {
        return isDateLikeFieldType(getFieldType?.(node.reference));
    }
    return false;
}

function resolveDateLikeOperand(
    node: FormulaAstNode,
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
): ResolvedDateLike {
    if (node.type === "date_literal") {
        const date = parseIsoDateLiteral(node.value);
        if (!date) {
            return { ok: false, reason: "error" };
        }
        return { ok: true, kind: "date_literal", date };
    }
    if (node.type !== "field") {
        return { ok: false, reason: "error" };
    }
    const fieldType = getFieldType?.(node.reference);
    if (!isDateLikeFieldType(fieldType)) {
        return { ok: false, reason: "error" };
    }
    const date = parseReportDateValue(getFieldValue(node.reference));
    if (date === null) {
        return { ok: false, reason: "missing_operand" };
    }
    return {
        ok: true,
        kind: isDateTimeFieldType(fieldType) ? "datetime" : "date",
        date,
    };
}

/**
 * Date compare rules (PRD):
 * - date vs date (fields/literals): UTC calendar day
 * - datetime vs datetime: full instant
 * - date field vs datetime field: date as UTC midnight, then instant compare
 * - datetime field vs typed date: calendar day
 */
function evaluateDateCompare(
    operator: FormulaCompareOperator,
    left: FormulaAstNode,
    right: FormulaAstNode,
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
): FormulaEvalResult {
    const leftResolved = resolveDateLikeOperand(left, getFieldValue, getFieldType);
    if (!leftResolved.ok) {
        return nullResult(leftResolved.reason);
    }
    const rightResolved = resolveDateLikeOperand(
        right,
        getFieldValue,
        getFieldType
    );
    if (!rightResolved.ok) {
        return nullResult(rightResolved.reason);
    }

    const leftKind = leftResolved.kind;
    const rightKind = rightResolved.kind;
    const datetimeVsLiteral =
        (leftKind === "datetime" && rightKind === "date_literal") ||
        (rightKind === "datetime" && leftKind === "date_literal");
    const bothCalendarDay =
        datetimeVsLiteral ||
        (leftKind !== "datetime" && rightKind !== "datetime");

    const equal = bothCalendarDay
        ? compareCalendarDays(
              leftResolved.date,
              rightResolved.date,
              operator
          )
        : compareInstants(
              leftKind === "date"
                  ? getUtcMidnightMs(leftResolved.date)
                  : leftResolved.date.getTime(),
              rightKind === "date"
                  ? getUtcMidnightMs(rightResolved.date)
                  : rightResolved.date.getTime(),
              operator
          );

    return valueResult(new Prisma.Decimal(equal ? 1 : 0));
}

/**
 * Number compares use the same Decimal values as arithmetic (exact cmp, not display rounding).
 */
function evaluateNumberCompare(
    operator: FormulaCompareOperator,
    left: FormulaAstNode,
    right: FormulaAstNode,
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
): FormulaEvalResult {
    const leftResult = evaluateFormulaAst(left, getFieldValue, getFieldType);
    const rightResult = evaluateFormulaAst(right, getFieldValue, getFieldType);
    if (leftResult.value === null || rightResult.value === null) {
        if (
            leftResult.nullReason === "missing_operand" ||
            rightResult.nullReason === "missing_operand"
        ) {
            return nullResult("missing_operand");
        }
        return nullResult(
            leftResult.nullReason || rightResult.nullReason || "error"
        );
    }
    const equal = applyCompare(
        leftResult.value.cmp(rightResult.value),
        operator
    );
    return valueResult(new Prisma.Decimal(equal ? 1 : 0));
}

function evaluateCompare(
    operator: FormulaCompareOperator,
    left: FormulaAstNode,
    right: FormulaAstNode,
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
): FormulaEvalResult {
    const leftDate = isDateLikeCompareOperand(left, getFieldType);
    const rightDate = isDateLikeCompareOperand(right, getFieldType);
    if (leftDate && rightDate) {
        return evaluateDateCompare(
            operator,
            left,
            right,
            getFieldValue,
            getFieldType
        );
    }
    // Mixed date-like vs numeric (or other) is invalid.
    if (leftDate || rightDate) {
        return nullResult("error");
    }
    return evaluateNumberCompare(
        operator,
        left,
        right,
        getFieldValue,
        getFieldType
    );
}

export function evaluateFormulaAst(
    node: FormulaAstNode,
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
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
    if (node.type === "date_literal") {
        // Date literals are only valid inside compares.
        return nullResult("error");
    }
    if (node.type === "field") {
        if (isDateLikeFieldType(getFieldType?.(node.reference))) {
            // Date/datetime fields are only valid inside compares.
            return nullResult("error");
        }
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
        const operand = evaluateFormulaAst(
            node.operand,
            getFieldValue,
            getFieldType
        );
        if (operand.value === null) {
            return nullResult(operand.nullReason || "error");
        }
        return valueResult(
            node.operator === "-" ? operand.value.neg() : operand.value
        );
    }

    if (isFormulaCompareOperator(node.operator)) {
        return evaluateCompare(
            node.operator,
            node.left,
            node.right,
            getFieldValue,
            getFieldType
        );
    }

    const left = evaluateFormulaAst(node.left, getFieldValue, getFieldType);
    const right = evaluateFormulaAst(node.right, getFieldValue, getFieldType);
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
            default:
                return nullResult("error");
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
    getFieldValue: (reference: string) => unknown,
    getFieldType?: FormulaFieldTypeResolver
): FormulaEvalResult {
    return evaluateFormulaAst(
        parseFormulaExpression(expression),
        getFieldValue,
        getFieldType
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

/** Exported for execution helpers that need date-like type checks. */
export function isFormulaDateLikeFieldType(type?: string): boolean {
    return isDateLikeFieldType(type);
}
