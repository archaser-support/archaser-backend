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
 * Prefer a full unique chain via {@link resolveKeysetOrderFields} / extension
 * hooks — KLINE alone is not unique across documents on the same FNCDATE.
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

/**
 * Keep only fields that exist on the table, preserving caller order.
 * Returns [] when nothing usable remains.
 */
export function filterKeysetOrderFields(
    fields: readonly string[] | null | undefined,
    columns: Set<string>
): string[] {
    if (!fields || fields.length === 0) {
        return [];
    }
    const out: string[] = [];
    const seen = new Set<string>();
    for (const field of fields) {
        const name = field.trim();
        if (!name || seen.has(name) || !columns.has(name)) {
            continue;
        }
        seen.add(name);
        out.push(name);
    }
    return out;
}

/** Encode N keyset field values (must not contain `|`). */
export function encodeKeysetCursorValues(values: readonly string[]): string {
    return values.map((value) => value.trim()).join(KEYSET_CURSOR_SEP);
}

export function parseKeysetCursorValues(afterKey: string): string[] {
    return afterKey
        .trim()
        .split(KEYSET_CURSOR_SEP)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
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
    return encodeKeysetCursorValues([p, s]);
}

export function parseKeysetCursor(afterKey: string): {
    primary: string;
    secondary: string | null;
} {
    const parts = parseKeysetCursorValues(afterKey);
    return {
        primary: parts[0] ?? afterKey.trim(),
        secondary: parts[1] ?? null,
    };
}

function odataQuotedString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

/** ISO DateTimeOffset / date — must stay unquoted for Edm.DateTimeOffset compares. */
function isODataDateTimeLiteral(value: string): boolean {
    return (
        /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/i.test(value.trim()) ||
        /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    );
}

/** Known Edm.Int32 / numeric keyset fields — everything else is quoted string. */
const ODATA_INT_KEYSET_FIELDS = new Set(["KLINE"]);

/** KLINE is Edm.Int32; FNCNUM and most Priority keys are Edm.String. */
function odataKeysetFieldLiteral(field: string, value: string): string {
    if (ODATA_INT_KEYSET_FIELDS.has(field) && /^-?\d+$/.test(value)) {
        return value;
    }
    if (isODataDateTimeLiteral(value)) {
        return value.trim();
    }
    return odataQuotedString(value);
}

function odataOrderByLiteral(value: string): string {
    if (isODataDateTimeLiteral(value)) {
        return value.trim();
    }
    if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
        return value.trim();
    }
    return odataQuotedString(value);
}

/**
 * Lexicographic keyset filter for N ordered fields.
 * Example fields [A,B,C] values [a,b,c]:
 *   (A gt a) or ((A eq a) and (B gt b)) or ((A eq a) and (B eq b) and (C gt c))
 * When the cursor has fewer values than fields (resume mid-upgrade), only the
 * matching prefix is applied.
 */
export function buildKeysetFilterForFields(
    fields: readonly string[],
    afterKey: string
): string {
    if (fields.length === 0) {
        throw new Error("buildKeysetFilterForFields requires at least one field");
    }
    const values = parseKeysetCursorValues(afterKey);
    if (values.length === 0) {
        throw new Error("buildKeysetFilterForFields requires a non-empty afterKey");
    }
    const depth = Math.min(fields.length, values.length);
    const clauses: string[] = [];
    for (let i = 0; i < depth; i++) {
        const parts: string[] = [];
        for (let j = 0; j < i; j++) {
            const field = fields[j]!;
            const lit =
                j === 0
                    ? odataOrderByLiteral(values[j]!)
                    : odataKeysetFieldLiteral(field, values[j]!);
            parts.push(`(${field} eq ${lit})`);
        }
        const field = fields[i]!;
        const lit =
            i === 0
                ? odataOrderByLiteral(values[i]!)
                : odataKeysetFieldLiteral(field, values[i]!);
        parts.push(`(${field} gt ${lit})`);
        clauses.push(
            parts.length === 1 ? parts[0]! : `(${parts.join(" and ")})`
        );
    }
    return clauses.length === 1 ? clauses[0]! : clauses.join(" or ");
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
    const fields = tieBreaker ? [orderBy, tieBreaker] : [orderBy];
    return buildKeysetFilterForFields(fields, afterKey);
}

export function formatOrderByFields(fields: readonly string[]): string {
    return fields.join(",");
}

export function formatOrderByClause(
    orderBy: string,
    tieBreaker: string | null
): string {
    return formatOrderByFields(
        tieBreaker ? [orderBy, tieBreaker] : [orderBy]
    );
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
