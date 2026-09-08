export type PullFilterOperator =
    | "eq"
    | "ne"
    | "startswith"
    | "contains"
    | "gt"
    | "lt";

export interface PullFilterRule {
    field: string;
    operator: PullFilterOperator;
    value: string;
}

export interface AdvancedEntityPullFilter {
    mode: "advanced";
    odata: string;
}

export interface RulesEntityPullFilter {
    mode: "rules";
    rules: PullFilterRule[];
}

export type EntityPullFilterConfig =
    | AdvancedEntityPullFilter
    | RulesEntityPullFilter;

export function andODataFilters(
    ...parts: Array<string | null | undefined>
): string | null {
    const cleaned = parts
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter((part) => part.length > 0);
    if (cleaned.length === 0) {
        return null;
    }
    if (cleaned.length === 1) {
        return cleaned[0] ?? null;
    }
    return cleaned.map((part) => `(${part})`).join(" and ");
}

export function escapeODataStringLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

function formatComparisonLiteral(value: string): string {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.+-]+Z?)?$/.test(trimmed)) {
        return trimmed;
    }
    return escapeODataStringLiteral(trimmed);
}

function compilePullFilterRule(rule: PullFilterRule): string | null {
    const field = rule.field.trim();
    if (!field || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
        return null;
    }
    switch (rule.operator) {
        case "eq":
            return `${field} eq ${escapeODataStringLiteral(rule.value)}`;
        case "ne":
            return `${field} ne ${escapeODataStringLiteral(rule.value)}`;
        case "startswith":
            return `startswith(${field},${escapeODataStringLiteral(rule.value)})`;
        case "contains":
            return `contains(${field},${escapeODataStringLiteral(rule.value)})`;
        case "gt":
            return `${field} gt ${formatComparisonLiteral(rule.value)}`;
        case "lt":
            return `${field} lt ${formatComparisonLiteral(rule.value)}`;
        default:
            return null;
    }
}

/**
 * Compile stored entity filter to OData $filter text.
 * Rules AND together. Advanced mode returns the stored expression as-is.
 */
export function compileEntityPullFilter(
    config: EntityPullFilterConfig | null | undefined
): string | null {
    if (!config) {
        return null;
    }
    if (config.mode === "advanced") {
        const odata = config.odata.trim();
        return odata.length > 0 ? odata : null;
    }
    if (config.mode === "rules") {
        const parts = config.rules
            .map((rule) => compilePullFilterRule(rule))
            .filter((part): part is string => Boolean(part));
        return andODataFilters(...parts);
    }
    return null;
}

function unwrapBalancedOuterParens(expr: string): string {
    let s = expr.trim();
    while (s.startsWith("(") && s.endsWith(")")) {
        let depth = 0;
        let balanced = true;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (ch === "(") {
                depth += 1;
            } else if (ch === ")") {
                depth -= 1;
                if (depth === 0 && i < s.length - 1) {
                    balanced = false;
                    break;
                }
                if (depth < 0) {
                    balanced = false;
                    break;
                }
            }
        }
        if (!balanced || depth !== 0) {
            break;
        }
        s = s.slice(1, -1).trim();
    }
    return s;
}

function splitTopLevelAnd(expr: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    const s = expr.trim();
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "(") {
            depth += 1;
            continue;
        }
        if (ch === ")") {
            depth -= 1;
            continue;
        }
        if (depth !== 0) {
            continue;
        }
        if (/^and\b/i.test(s.slice(i))) {
            const before = s.slice(start, i).trim();
            if (before) {
                parts.push(before);
            }
            i += 2; // skip "and"
            while (i + 1 < s.length && /\s/.test(s[i + 1]!)) {
                i += 1;
            }
            start = i + 1;
        }
    }
    const tail = s.slice(start).trim();
    if (tail) {
        parts.push(tail);
    }
    return parts.length > 0 ? parts : [s];
}

function splitTopLevelOr(expr: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    const s = expr.trim();
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "(") {
            depth += 1;
            continue;
        }
        if (ch === ")") {
            depth -= 1;
            continue;
        }
        if (depth !== 0) {
            continue;
        }
        if (/^or\b/i.test(s.slice(i))) {
            const before = s.slice(start, i).trim();
            if (before) {
                parts.push(before);
            }
            i += 1; // skip "or"
            while (i + 1 < s.length && /\s/.test(s[i + 1]!)) {
                i += 1;
            }
            start = i + 1;
        }
    }
    const tail = s.slice(start).trim();
    if (tail) {
        parts.push(tail);
    }
    return parts.length > 0 ? parts : [s];
}

const FNCPATNAME_EQ_RE =
    /^\(?\s*FNCPATNAME\s+eq\s+'((?:[^']|'')*)'\s*\)?$/i;

/** Pure `FNCPATNAME eq '…' or …` group → literal values (unescaped). */
function extractFncPatNameEqLiterals(conjunct: string): string[] | null {
    const unwrapped = unwrapBalancedOuterParens(conjunct);
    const parts = splitTopLevelOr(unwrapped);
    if (parts.length === 0) {
        return null;
    }
    const values: string[] = [];
    for (const part of parts) {
        const match = FNCPATNAME_EQ_RE.exec(unwrapBalancedOuterParens(part));
        if (!match?.[1]) {
            return null;
        }
        values.push(match[1].replace(/''/g, "'"));
    }
    return values;
}

/**
 * Split a Payment $filter that ORs several FNCPATNAME eq values into one
 * filter per value. Walks nested AND groups. Priority often 502s on the
 * combined OR; each single-eq pull keeps the same receipt-code semantics.
 *
 * Returns `[original]` when there is no multi-value FNCPATNAME OR group.
 */
export function expandPaymentFncPatNameOrFilters(
    filter: string | null | undefined
): string[] {
    if (filter == null) {
        return [];
    }
    const trimmed = filter.trim();
    if (!trimmed) {
        return [];
    }
    if (!/\bFNCPATNAME\b/i.test(trimmed)) {
        return [trimmed];
    }

    const direct = extractFncPatNameEqLiterals(trimmed);
    if (direct && direct.length > 1) {
        return direct.map(
            (value) => `FNCPATNAME eq ${escapeODataStringLiteral(value)}`
        );
    }

    const andParts = splitTopLevelAnd(unwrapBalancedOuterParens(trimmed));
    if (andParts.length <= 1) {
        return [trimmed];
    }

    for (let i = 0; i < andParts.length; i++) {
        const partExpanded = expandPaymentFncPatNameOrFilters(andParts[i]);
        if (partExpanded.length > 1) {
            return partExpanded.map(
                (partFilter) =>
                    andODataFilters(
                        ...andParts.map((part, index) =>
                            index === i ? partFilter : part
                        )
                    ) ?? trimmed
            );
        }
    }

    return [trimmed];
}

/**
 * Preview / column-sample only: drop AND-conjuncts that reference FNCPATNAME
 * when a fast sample is enough. Live Payment pulls must keep FNCPATNAME —
 * use {@link expandPaymentFncPatNameOrFilters} instead of dropping codes.
 */
export function lightenPaymentPullODataFilter(
    filter: string | null | undefined
): string | null {
    if (filter == null) {
        return null;
    }
    const trimmed = filter.trim();
    if (!trimmed) {
        return null;
    }
    if (!/\bFNCPATNAME\b/i.test(trimmed)) {
        return trimmed;
    }

    const lighten = (expr: string): string | null => {
        const unwrapped = unwrapBalancedOuterParens(expr);
        const parts = splitTopLevelAnd(unwrapped);
        if (parts.length <= 1) {
            return /\bFNCPATNAME\b/i.test(unwrapped) ? null : unwrapped;
        }
        const kept: string[] = [];
        for (const part of parts) {
            if (/\bFNCPATNAME\b/i.test(part)) {
                // Drop this conjunct entirely when it is only FNCPATNAME logic;
                // if nested ANDs mix FNCPATNAME with other fields, recurse.
                const nested = unwrapBalancedOuterParens(part);
                const nestedParts = splitTopLevelAnd(nested);
                if (nestedParts.length > 1) {
                    const nestedKept = lighten(part);
                    if (nestedKept) {
                        kept.push(nestedKept);
                    }
                }
                continue;
            }
            kept.push(part);
        }
        return andODataFilters(...kept);
    };

    return lighten(trimmed);
}

/** @deprecated Prefer {@link lightenPaymentPullODataFilter}. */
export const lightenPaymentPreviewODataFilter = lightenPaymentPullODataFilter;
