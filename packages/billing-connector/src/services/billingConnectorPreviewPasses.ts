import type { ImportType, Prisma } from "@prisma/client";

import { isPriorityEntityImportType } from "../priority/priorityApiContract";

export interface EntityPreviewPass {
    passed: boolean;
    completed_at: string;
}

export type PreviewPassesMap = Partial<Record<ImportType, EntityPreviewPass>>;

const ENTITY_KEYS: ImportType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

function isImportType(value: string): value is ImportType {
    return (ENTITY_KEYS as string[]).includes(value);
}

export function parsePreviewPassesMap(raw: unknown): PreviewPassesMap {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: PreviewPassesMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isImportType(key) || !isPriorityEntityImportType(key)) {
            continue;
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
        }
        const record = value as Record<string, unknown>;
        if (typeof record.passed !== "boolean") {
            continue;
        }
        const completedAt =
            typeof record.completed_at === "string" && record.completed_at.trim()
                ? record.completed_at.trim()
                : null;
        if (!completedAt) {
            continue;
        }
        out[key] = { passed: record.passed, completed_at: completedAt };
    }
    return out;
}

export function previewPassesToPrismaJson(
    map: PreviewPassesMap
): Prisma.InputJsonValue {
    return map as Prisma.InputJsonValue;
}

export function clearPreviewPass(
    existing: unknown,
    importType: ImportType
): PreviewPassesMap {
    const next = { ...parsePreviewPassesMap(existing) };
    delete next[importType];
    return next;
}

export function clearPreviewPasses(
    existing: unknown,
    importTypes: ImportType[]
): PreviewPassesMap {
    const next = { ...parsePreviewPassesMap(existing) };
    for (const importType of importTypes) {
        delete next[importType];
    }
    return next;
}

export function setPreviewPass(
    existing: unknown,
    importType: ImportType,
    passed: boolean,
    completedAt: Date = new Date()
): PreviewPassesMap {
    const next = { ...parsePreviewPassesMap(existing) };
    next[importType] = {
        passed,
        completed_at: completedAt.toISOString(),
    };
    return next;
}

export function setPreviewPasses(
    existing: unknown,
    updates: Array<{ importType: ImportType; passed: boolean }>,
    completedAt: Date = new Date()
): PreviewPassesMap {
    let next = parsePreviewPassesMap(existing);
    for (const update of updates) {
        next = setPreviewPass(
            next,
            update.importType,
            update.passed,
            completedAt
        );
    }
    return next;
}

/**
 * True when every enabled entity has a stored passing preview.
 */
export function allEnabledEntitiesPreviewPassed(
    enabledEntities: ImportType[],
    previewPasses: unknown
): boolean {
    if (enabledEntities.length === 0) {
        return false;
    }
    const map = parsePreviewPassesMap(previewPasses);
    return enabledEntities.every((entity) => map[entity]?.passed === true);
}

/**
 * Entity-level pass from one preview entity result (ignores global cutover info checks).
 */
export function computeEntityPreviewPassed(entity: {
    validation_errors: string[];
    sample_rows: unknown[];
    sorted_preview: boolean;
    import_type: ImportType;
}): boolean {
    if (entity.validation_errors.length > 0) {
        return false;
    }
    // Empty samples are allowed — a customer (or account) may have no
    // payments/invoices for the cutover window; that must not block import.
    if (entity.sample_rows.length === 0) {
        return true;
    }
    if (entity.import_type === "Invoice" && !entity.sorted_preview) {
        return false;
    }
    return true;
}
