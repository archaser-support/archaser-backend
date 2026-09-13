import {
    MAX_FORMULA_AST_DEPTH,
    MAX_FORMULA_EXPRESSION_LENGTH,
} from "./types";

export type FormulaParseErrorCode =
    | "empty_expression"
    | "expression_too_long"
    | "unexpected_character"
    | "unclosed_parenthesis"
    | "unclosed_reference"
    | "invalid_reference"
    | "missing_operand"
    | "overflow"
    | "prohibited_token"
    | "invalid_date_literal"
    | "clock_time_not_allowed";

export class FormulaParseError extends Error {
    constructor(
        public readonly code: FormulaParseErrorCode,
        message: string
    ) {
        super(message);
        this.name = "FormulaParseError";
    }
}

export type FormulaCompareOperator = "=" | "!=" | "<" | ">" | "<=" | ">=";

export type FormulaBinaryOperator =
    | "+"
    | "-"
    | "*"
    | "/"
    | FormulaCompareOperator;

export type FormulaAstNode =
    | { type: "number"; value: string }
    | { type: "date_literal"; value: string }
    | { type: "field"; reference: string }
    | { type: "unary"; operator: "+" | "-"; operand: FormulaAstNode }
    | {
          type: "binary";
          operator: FormulaBinaryOperator;
          left: FormulaAstNode;
          right: FormulaAstNode;
      };

const OPERAND_REF_TOKEN_PATTERN =
    /^\[(?:formula:[A-Za-z0-9][A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9_.]*)\]$/;
const OPERAND_REF_EXTRACT_PATTERN =
    /\[(formula:[A-Za-z0-9][A-Za-z0-9_-]*|[A-Za-z][A-Za-z0-9_.]*)\]/g;
const PROHIBITED_TOKENS =
    /\b(eval|function|return|new|typeof|window|global|import|require)\b/i;
const ISO_DATE_TOKEN_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const COMPARE_OPERATORS = new Set<string>([
    "=",
    "!=",
    "<",
    ">",
    "<=",
    ">=",
]);

export function isFormulaCompareOperator(
    operator: string
): operator is FormulaCompareOperator {
    return COMPARE_OPERATORS.has(operator);
}

export function isFormulaOperandReference(reference: string): boolean {
    return reference.startsWith("formula:");
}

export function getFormulaIdFromOperandReference(
    reference: string
): string | null {
    if (!isFormulaOperandReference(reference)) {
        return null;
    }
    return reference.slice("formula:".length) || null;
}

export function extractFieldReferences(expression: string): string[] {
    const refs: string[] = [];
    const re = new RegExp(OPERAND_REF_EXTRACT_PATTERN.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(expression)) !== null) {
        refs.push(match[1]);
    }
    return refs;
}

function isValidIsoCalendarDate(
    year: number,
    month: number,
    day: number
): boolean {
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/** Try to read YYYY-MM-DD at `pos`. Returns the token length (10) or null. */
function matchIsoDateTokenAt(
    input: string,
    pos: number
): { value: string } | null {
    const match = input.slice(pos).match(ISO_DATE_TOKEN_PATTERN);
    if (!match) {
        return null;
    }
    const end = pos + match[0].length;
    if (end < input.length && /[0-9]/.test(input[end])) {
        return null;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidIsoCalendarDate(year, month, day)) {
        throw new FormulaParseError(
            "invalid_date_literal",
            `Invalid date literal: ${match[0]}`
        );
    }
    return { value: match[0] };
}

function assertNoClockTimeSuffix(input: string, pos: number): void {
    let i = pos;
    while (i < input.length && /\s/.test(input[i])) {
        i += 1;
    }
    if (i >= input.length) {
        return;
    }
    if (input[i] === "T" || input[i] === "t") {
        throw new FormulaParseError(
            "clock_time_not_allowed",
            "Clock time is not allowed in date literals"
        );
    }
    if (/^\d{1,2}:\d{2}/.test(input.slice(i))) {
        throw new FormulaParseError(
            "clock_time_not_allowed",
            "Clock time is not allowed in date literals"
        );
    }
}

export function normalizeFormulaExpression(
    expression: string,
    decimalSeparator: "." | "," = "."
): string {
    const trimmed = expression.trim();
    if (!trimmed) {
        return "";
    }

    let out = "";
    let i = 0;
    while (i < trimmed.length) {
        const ch = trimmed[i];
        if (/\s/.test(ch)) {
            i += 1;
            continue;
        }
        if (ch === "[") {
            const end = trimmed.indexOf("]", i);
            if (end === -1) {
                throw new FormulaParseError(
                    "unclosed_reference",
                    "Unclosed field reference"
                );
            }
            out += trimmed.slice(i, end + 1);
            i = end + 1;
            continue;
        }
        const isoDate = matchIsoDateTokenAt(trimmed, i);
        if (isoDate) {
            assertNoClockTimeSuffix(trimmed, i + isoDate.value.length);
            out += isoDate.value;
            i += isoDate.value.length;
            continue;
        }
        if (/[0-9]/.test(ch) || ch === decimalSeparator) {
            let num = "";
            while (i < trimmed.length) {
                const c = trimmed[i];
                if (/[0-9]/.test(c) || c === decimalSeparator) {
                    num += c === decimalSeparator ? "." : c;
                    i += 1;
                } else {
                    break;
                }
            }
            out += num;
            continue;
        }
        if (ch === "!" && trimmed[i + 1] === "=") {
            out += "!=";
            i += 2;
            continue;
        }
        if ((ch === "<" || ch === ">") && trimmed[i + 1] === "=") {
            out += `${ch}=`;
            i += 2;
            continue;
        }
        if ("+-*/()=<>".includes(ch)) {
            out += ch;
            i += 1;
            continue;
        }
        throw new FormulaParseError(
            "unexpected_character",
            `Unexpected character: ${ch}`
        );
    }
    return out;
}

function getAstDepth(node: FormulaAstNode): number {
    if (
        node.type === "number" ||
        node.type === "field" ||
        node.type === "date_literal"
    ) {
        return 1;
    }
    if (node.type === "unary") {
        return 1 + getAstDepth(node.operand);
    }
    return 1 + Math.max(getAstDepth(node.left), getAstDepth(node.right));
}

class Tokenizer {
    private pos = 0;

    constructor(private readonly input: string) {}

    peek(): string | null {
        this.skipWhitespace();
        return this.pos < this.input.length ? this.input[this.pos] : null;
    }

    consume(): string | null {
        this.skipWhitespace();
        return this.pos < this.input.length ? this.input[this.pos++] : null;
    }

    private skipWhitespace(): void {
        while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
            this.pos += 1;
        }
    }

    consumeFieldReference(): string | null {
        this.skipWhitespace();
        if (this.input[this.pos] !== "[") {
            return null;
        }
        const end = this.input.indexOf("]", this.pos);
        if (end === -1) {
            throw new FormulaParseError(
                "unclosed_reference",
                "Unclosed field reference"
            );
        }
        const token = this.input.slice(this.pos, end + 1);
        if (!OPERAND_REF_TOKEN_PATTERN.test(token)) {
            throw new FormulaParseError(
                "invalid_reference",
                `Invalid field reference: ${token}`
            );
        }
        this.pos = end + 1;
        return token.slice(1, -1);
    }

    consumeDateLiteral(): string | null {
        this.skipWhitespace();
        const matched = matchIsoDateTokenAt(this.input, this.pos);
        if (!matched) {
            return null;
        }
        this.pos += matched.value.length;
        assertNoClockTimeSuffix(this.input, this.pos);
        return matched.value;
    }

    consumeNumber(): string | null {
        this.skipWhitespace();
        const start = this.pos;
        if (this.pos >= this.input.length) {
            return null;
        }
        if (this.input[this.pos] !== "." && !/[0-9]/.test(this.input[this.pos])) {
            return null;
        }
        let sawDigit = false;
        while (this.pos < this.input.length) {
            const ch = this.input[this.pos];
            if (/[0-9]/.test(ch)) {
                sawDigit = true;
                this.pos += 1;
            } else if (ch === ".") {
                if (this.input.slice(start, this.pos).includes(".")) {
                    break;
                }
                this.pos += 1;
            } else {
                break;
            }
        }
        return sawDigit ? this.input.slice(start, this.pos) : null;
    }

    consumeCompareOperator(): FormulaCompareOperator | null {
        this.skipWhitespace();
        const ch = this.pos < this.input.length ? this.input[this.pos] : null;
        if (ch === "=") {
            this.pos += 1;
            return "=";
        }
        if (ch === "!") {
            if (this.input[this.pos + 1] !== "=") {
                throw new FormulaParseError(
                    "unexpected_character",
                    "Unexpected character: !"
                );
            }
            this.pos += 2;
            return "!=";
        }
        if (ch === "<") {
            this.pos += 1;
            if (this.input[this.pos] === "=") {
                this.pos += 1;
                return "<=";
            }
            return "<";
        }
        if (ch === ">") {
            this.pos += 1;
            if (this.input[this.pos] === "=") {
                this.pos += 1;
                return ">=";
            }
            return ">";
        }
        return null;
    }
}

class Parser {
    private readonly tokenizer: Tokenizer;

    constructor(expression: string) {
        this.tokenizer = new Tokenizer(expression);
    }

    parse(): FormulaAstNode {
        const node = this.parseCompare();
        if (this.tokenizer.peek() !== null) {
            throw new FormulaParseError(
                "unexpected_character",
                "Unexpected trailing tokens"
            );
        }
        if (getAstDepth(node) > MAX_FORMULA_AST_DEPTH) {
            throw new FormulaParseError(
                "overflow",
                `Expression exceeds maximum depth of ${MAX_FORMULA_AST_DEPTH}`
            );
        }
        return node;
    }

    /** Compare operators bind looser than `+ − × ÷`. */
    private parseCompare(): FormulaAstNode {
        let left = this.parseAddSub();
        while (true) {
            const op = this.tokenizer.consumeCompareOperator();
            if (!op) {
                return left;
            }
            left = {
                type: "binary",
                operator: op,
                left,
                right: this.parseAddSub(),
            };
        }
    }

    private parseAddSub(): FormulaAstNode {
        let left = this.parseMulDiv();
        while (true) {
            const op = this.tokenizer.peek();
            if (op !== "+" && op !== "-") {
                return left;
            }
            this.tokenizer.consume();
            left = {
                type: "binary",
                operator: op,
                left,
                right: this.parseMulDiv(),
            };
        }
    }

    private parseMulDiv(): FormulaAstNode {
        let left = this.parseUnary();
        while (true) {
            const op = this.tokenizer.peek();
            if (op !== "*" && op !== "/") {
                return left;
            }
            this.tokenizer.consume();
            left = {
                type: "binary",
                operator: op,
                left,
                right: this.parseUnary(),
            };
        }
    }

    private parseUnary(): FormulaAstNode {
        const op = this.tokenizer.peek();
        if (op === "+" || op === "-") {
            this.tokenizer.consume();
            return { type: "unary", operator: op, operand: this.parseUnary() };
        }
        return this.parsePrimary();
    }

    private parsePrimary(): FormulaAstNode {
        const fieldRef = this.tokenizer.consumeFieldReference();
        if (fieldRef) {
            return { type: "field", reference: fieldRef };
        }
        const dateLiteral = this.tokenizer.consumeDateLiteral();
        if (dateLiteral) {
            return { type: "date_literal", value: dateLiteral };
        }
        const num = this.tokenizer.consumeNumber();
        if (num) {
            return { type: "number", value: num };
        }
        const ch = this.tokenizer.peek();
        if (ch === "(") {
            this.tokenizer.consume();
            const inner = this.parseCompare();
            if (this.tokenizer.consume() !== ")") {
                throw new FormulaParseError(
                    "unclosed_parenthesis",
                    "Unclosed parenthesis"
                );
            }
            return inner;
        }
        if (ch === null) {
            throw new FormulaParseError(
                "missing_operand",
                "Expected number, field reference, date, or parenthesized expression"
            );
        }
        throw new FormulaParseError(
            "unexpected_character",
            `Unexpected character: ${ch}`
        );
    }
}

export function parseFormulaExpression(expression: string): FormulaAstNode {
    const normalized = expression.trim();
    if (!normalized) {
        throw new FormulaParseError("empty_expression", "Expression is required");
    }
    if (normalized.length > MAX_FORMULA_EXPRESSION_LENGTH) {
        throw new FormulaParseError(
            "expression_too_long",
            `Expression exceeds maximum length of ${MAX_FORMULA_EXPRESSION_LENGTH}`
        );
    }
    if (PROHIBITED_TOKENS.test(normalized)) {
        throw new FormulaParseError(
            "prohibited_token",
            "Expression contains prohibited tokens"
        );
    }
    return new Parser(normalized).parse();
}
