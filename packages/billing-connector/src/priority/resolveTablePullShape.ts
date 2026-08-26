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
