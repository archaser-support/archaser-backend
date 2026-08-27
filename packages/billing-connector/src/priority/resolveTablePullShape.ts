const ODATA_KEYWORDS = new Set([
    "and",
    "or",
    "not",
    "eq",
    "ne",
    "gt",
    "ge",
    "lt",
    "le",
    "true",
    "false",
    "null",
    "startswith",
    "contains",
    "endswith",
    "substringof",
]);

export const ORDER_BY_FALLBACKS = [
    "FNCNUM",
    "IVNUM",
    "PAYNUM",
    "CUSTNAME",
] as const;

export const DATE_FIELD_FALLBACKS = [
    "FNCDATE",
    "PAYDATE",
    "IVDATE",
    "BALDATE",
    "UDATE",
] as const;

/**
 * Secondary sort for keyset pagination when the primary order-by is not unique
 * (e.g. IDG_ARFNCITEMS4: many KLINE rows share one FNCNUM).
 */
export const KEYSET_TIE_BREAKER_FIELDS = ["KLINE"] as const;

const KEYSET_CURSOR_SEP = "|";

export function columnNameSet(headers: readonly string[]): Set<string> {
    return new Set(
        headers.map((name) => name.trim()).filter((name) => name.length > 0)
    );
}

export function pickOrderByField(
    defaultOrderBy: string,
    columns: Set<string>
): string {
    if (columns.has(defaultOrderBy)) {
        return defaultOrderBy;
    }
    for (const name of ORDER_BY_FALLBACKS) {
        if (columns.has(name)) {
            return name;
        }
    }
    throw new Error(
        `No sort column on this table (tried ${defaultOrderBy}, ${ORDER_BY_FALLBACKS.join(", ")})`
    );
}

/** Prefer KLINE when present and not already the primary order-by. */
export function pickKeysetTieBreaker(
    columns: Set<string>,
    primaryOrderBy: string
): string | null {
    for (const name of KEYSET_TIE_BREAKER_FIELDS) {
        if (name !== primaryOrderBy && columns.has(name)) {
            return name;
        }
    }
    return null;
}

export function encodeKeysetCursor(
    primary: string,
    secondary?: string | null
): string {
    const p = primary.trim();
    const s = secondary?.trim();
    if (!s) {
        return p;
    }
    return `${p}${KEYSET_CURSOR_SEP}${s}`;
}

export function parseKeysetCursor(afterKey: string): {
    primary: string;
    secondary: string | null;
} {
    const trimmed = afterKey.trim();
    const sep = trimmed.indexOf(KEYSET_CURSOR_SEP);
    if (sep < 0) {
        return { primary: trimmed, secondary: null };
    }
    const primary = trimmed.slice(0, sep).trim();
    const secondary = trimmed.slice(sep + 1).trim();
    return {
        primary,
        secondary: secondary.length > 0 ? secondary : null,
    };
}

function odataQuotedString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/** KLINE is usually Edm.Int32; other keyset fields are Edm.String. */
function odataTieBreakerLiteral(value: string): string {
    if (/^-?\d+$/.test(value)) {
        return value;
    }
    return odataQuotedString(value);
}

/**
 * Keyset filter after `afterKey`.
 * With a tie-breaker and composite cursor `primary|secondary`:
 *   (orderBy gt primary) or ((orderBy eq primary) and (tieBreaker gt secondary))
 * Legacy single-field cursors keep `orderBy gt primary`.
 */
export function buildKeysetFilter(
    orderBy: string,
    afterKey: string,
    tieBreaker: string | null
): string {
    const { primary, secondary } = parseKeysetCursor(afterKey);
    const primaryLit = odataQuotedString(primary);
    if (!tieBreaker || secondary == null) {
        return `${orderBy} gt ${primaryLit}`;
    }
    const secondaryLit = odataTieBreakerLiteral(secondary);
    return (
        `(${orderBy} gt ${primaryLit}) or ` +
        `((${orderBy} eq ${primaryLit}) and (${tieBreaker} gt ${secondaryLit}))`
    );
}

export function formatOrderByClause(
    orderBy: string,
    tieBreaker: string | null
): string {
    return tieBreaker ? `${orderBy},${tieBreaker}` : orderBy;
}

export function pickDateField(
    preferred: string | null | undefined,
    columns: Set<string>
): string | null {
    const want = preferred?.trim();
    if (want) {
        if (!columns.has(want)) {
            throw new Error(`Date field ${want} is not on this table`);
        }
        return want;
    }
    for (const name of DATE_FIELD_FALLBACKS) {
        if (columns.has(name)) {
            return name;
        }
    }
    return null;
}

export function intersectSelectFields(
    requested: readonly string[],
    columns: Set<string>,
    required: readonly string[]
): string[] {
    const selected = new Set<string>();
    for (const field of requested) {
        const name = field.trim();
        if (name && columns.has(name)) {
            selected.add(name);
        }
    }
    for (const field of required) {
        const name = field.trim();
        if (name && columns.has(name)) {
            selected.add(name);
        }
    }
    return Array.from(selected).sort((a, b) => a.localeCompare(b));
}

export function odataFilterFieldNames(filter: string | null | undefined): string[] {
    if (!filter?.trim()) {
        return [];
    }
    const stripped = filter
        .replace(/'([^']|'')*'/g, " ")
        .replace(/\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?/gi, " ");
    const names = new Set<string>();
    for (const match of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const name = match[1];
        if (!ODATA_KEYWORDS.has(name.toLowerCase())) {
            names.add(name);
        }
    }
    return Array.from(names);
}

export function assertFilterFieldsExist(
    filter: string | null | undefined,
    columns: Set<string>
): void {
    const missing = odataFilterFieldNames(filter).filter(
        (name) => !columns.has(name)
    );
    if (missing.length > 0) {
        throw new Error(
            `Pull filter fields not on this table: ${missing.join(", ")}`
        );
    }
}

export function columnNamesFromRecords(
    records: Record<string, unknown>[]
): string[] {
    const names = new Set<string>();
    for (const row of records) {
        for (const key of Object.keys(row)) {
            if (key.startsWith("@")) {
                continue;
            }
            if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                names.add(key);
            }
        }
    }
    return Array.from(names);
}
