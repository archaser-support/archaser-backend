"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEYSET_TIE_BREAKER_FIELDS = exports.DATE_FIELD_FALLBACKS = exports.ORDER_BY_FALLBACKS = void 0;
exports.columnNameSet = columnNameSet;
exports.pickOrderByField = pickOrderByField;
exports.pickKeysetTieBreaker = pickKeysetTieBreaker;
exports.encodeKeysetCursor = encodeKeysetCursor;
exports.parseKeysetCursor = parseKeysetCursor;
exports.buildKeysetFilter = buildKeysetFilter;
exports.formatOrderByClause = formatOrderByClause;
exports.pickDateField = pickDateField;
exports.intersectSelectFields = intersectSelectFields;
exports.odataFilterFieldNames = odataFilterFieldNames;
exports.assertFilterFieldsExist = assertFilterFieldsExist;
exports.columnNamesFromRecords = columnNamesFromRecords;
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
exports.ORDER_BY_FALLBACKS = [
    "FNCNUM",
    "IVNUM",
    "PAYNUM",
    "CUSTNAME",
];
exports.DATE_FIELD_FALLBACKS = [
    "FNCDATE",
    "PAYDATE",
    "IVDATE",
    "BALDATE",
    "UDATE",
];
/**
 * Secondary sort for keyset pagination when the primary order-by is not unique
 * (e.g. IDG_ARFNCITEMS4: many KLINE rows share one FNCNUM).
 */
exports.KEYSET_TIE_BREAKER_FIELDS = ["KLINE"];
const KEYSET_CURSOR_SEP = "|";
function columnNameSet(headers) {
    return new Set(headers.map((name) => name.trim()).filter((name) => name.length > 0));
}
function pickOrderByField(defaultOrderBy, columns) {
    if (columns.has(defaultOrderBy)) {
        return defaultOrderBy;
    }
    for (const name of exports.ORDER_BY_FALLBACKS) {
        if (columns.has(name)) {
            return name;
        }
    }
    throw new Error(`No sort column on this table (tried ${defaultOrderBy}, ${exports.ORDER_BY_FALLBACKS.join(", ")})`);
}
/** Prefer KLINE when present and not already the primary order-by. */
function pickKeysetTieBreaker(columns, primaryOrderBy) {
    for (const name of exports.KEYSET_TIE_BREAKER_FIELDS) {
        if (name !== primaryOrderBy && columns.has(name)) {
            return name;
        }
    }
    return null;
}
function encodeKeysetCursor(primary, secondary) {
    const p = primary.trim();
    const s = secondary?.trim();
    if (!s) {
        return p;
    }
    return `${p}${KEYSET_CURSOR_SEP}${s}`;
}
function parseKeysetCursor(afterKey) {
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
function odataQuotedString(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
/** KLINE is usually Edm.Int32; other keyset fields are Edm.String. */
function odataTieBreakerLiteral(value) {
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
function buildKeysetFilter(orderBy, afterKey, tieBreaker) {
    const { primary, secondary } = parseKeysetCursor(afterKey);
    const primaryLit = odataQuotedString(primary);
    if (!tieBreaker || secondary == null) {
        return `${orderBy} gt ${primaryLit}`;
    }
    const secondaryLit = odataTieBreakerLiteral(secondary);
    return (`(${orderBy} gt ${primaryLit}) or ` +
        `((${orderBy} eq ${primaryLit}) and (${tieBreaker} gt ${secondaryLit}))`);
}
function formatOrderByClause(orderBy, tieBreaker) {
    return tieBreaker ? `${orderBy},${tieBreaker}` : orderBy;
}
function pickDateField(preferred, columns) {
    const want = preferred?.trim();
    if (want) {
        if (!columns.has(want)) {
            throw new Error(`Date field ${want} is not on this table`);
        }
        return want;
    }
    for (const name of exports.DATE_FIELD_FALLBACKS) {
        if (columns.has(name)) {
            return name;
        }
    }
    return null;
}
function intersectSelectFields(requested, columns, required) {
    const selected = new Set();
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
function odataFilterFieldNames(filter) {
    if (!filter?.trim()) {
        return [];
    }
    const stripped = filter
        .replace(/'([^']|'')*'/g, " ")
        .replace(/\d{4}-\d{2}-\d{2}T[0-9:.+-]+Z?/gi, " ");
    const names = new Set();
    for (const match of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
        const name = match[1];
        if (!ODATA_KEYWORDS.has(name.toLowerCase())) {
            names.add(name);
        }
    }
    return Array.from(names);
}
function assertFilterFieldsExist(filter, columns) {
    const missing = odataFilterFieldNames(filter).filter((name) => !columns.has(name));
    if (missing.length > 0) {
        throw new Error(`Pull filter fields not on this table: ${missing.join(", ")}`);
    }
}
function columnNamesFromRecords(records) {
    const names = new Set();
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
