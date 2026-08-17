import type { ImportType, Prisma } from "@prisma/client";

import {
    getPriorityEntityEndpoint,
    isPriorityEntityImportType,
} from "../priority/priorityApiContract";

export type EntitySetsMap = Partial<Record<ImportType, string>>;

const ENTITY_KEYS: ImportType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

const ENTITY_SET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isImportType(value: string): value is ImportType {
    return (ENTITY_KEYS as string[]).includes(value);
}

/**
 * Normalize one entity-set name. Empty / whitespace → clear (use contract default).
 */
export function normalizeEntitySetName(
    value: unknown
): string | null | undefined {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
        return null;
    }
    if (!ENTITY_SET_NAME_RE.test(trimmed)) {
        throw Object.assign(
            new Error(
                `Invalid Priority table name "${trimmed}" (use letters, digits, underscore)`
            ),
            { statusCode: 400, code: "INVALID_ENTITY_SET" }
        );
    }
    return trimmed;
}

export function parseEntitySetsMap(raw: unknown): EntitySetsMap {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: EntitySetsMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isImportType(key)) {
            continue;
        }
        const normalized = normalizeEntitySetName(value);
        if (typeof normalized === "string") {
            out[key] = normalized;
        }
    }
    return out;
}

/**
 * Merge a partial patch into existing entity_sets.
 * Per-entity `null` or `""` clears that override.
 */
export function mergeEntitySetsPatch(
    existing: unknown,
    patch: Partial<Record<ImportType, string | null>> | undefined
): EntitySetsMap {
    const base = parseEntitySetsMap(existing);
    if (!patch) {
        return base;
    }
    const next: EntitySetsMap = { ...base };
    for (const [key, value] of Object.entries(patch) as Array<
        [ImportType, string | null | undefined]
    >) {
        if (!isImportType(key)) {
            continue;
        }
        if (value === undefined) {
            continue;
        }
        const normalized = normalizeEntitySetName(value);
        if (normalized === null || normalized === undefined) {
            delete next[key];
        } else {
            next[key] = normalized;
        }
    }
    return next;
}

export function entitySetsToPrismaJson(
    map: EntitySetsMap
): Prisma.InputJsonValue {
    return map as Prisma.InputJsonValue;
}

export function resolveEntityCollectionPath(
    importType: ImportType,
    entitySets?: EntitySetsMap | null
): string {
    if (!isPriorityEntityImportType(importType)) {
        throw new Error(`Unsupported import type: ${importType}`);
    }
    const override = entitySets?.[importType]?.trim();
    if (override) {
        return override;
    }
    return getPriorityEntityEndpoint(importType).path;
}

export function parseEntitySetCatalog(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const names: string[] = [];
    for (const item of raw) {
        if (typeof item !== "string") {
            continue;
        }
        const trimmed = item.trim();
        if (ENTITY_SET_NAME_RE.test(trimmed)) {
            names.push(trimmed);
        }
    }
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

export function entitySetCatalogToPrismaJson(
    names: string[]
): Prisma.InputJsonValue {
    return names as unknown as Prisma.InputJsonValue;
}

/** Import types whose entity-set override string changed. */
export function listChangedEntitySetEntities(params: {
    existing: unknown;
    next: EntitySetsMap;
}): ImportType[] {
    const prev = parseEntitySetsMap(params.existing);
    const changed: ImportType[] = [];
    for (const key of ENTITY_KEYS) {
        const before = prev[key] ?? "";
        const after = params.next[key] ?? "";
        if (before !== after) {
            changed.push(key);
        }
    }
    return changed;
}

export function getDefaultEntitySets(): Partial<Record<ImportType, string>> {
    return {
        Customer: getPriorityEntityEndpoint("Customer").path,
        Contact: getPriorityEntityEndpoint("Contact").path,
        Invoice: getPriorityEntityEndpoint("Invoice").path,
        Payment: getPriorityEntityEndpoint("Payment").path,
    };
}
