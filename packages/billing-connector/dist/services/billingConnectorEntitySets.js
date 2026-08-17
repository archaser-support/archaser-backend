"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeEntitySetName = normalizeEntitySetName;
exports.parseEntitySetsMap = parseEntitySetsMap;
exports.mergeEntitySetsPatch = mergeEntitySetsPatch;
exports.entitySetsToPrismaJson = entitySetsToPrismaJson;
exports.resolveEntityCollectionPath = resolveEntityCollectionPath;
exports.parseEntitySetCatalog = parseEntitySetCatalog;
exports.entitySetCatalogToPrismaJson = entitySetCatalogToPrismaJson;
exports.listChangedEntitySetEntities = listChangedEntitySetEntities;
exports.getDefaultEntitySets = getDefaultEntitySets;
const priorityApiContract_1 = require("../priority/priorityApiContract");
const ENTITY_KEYS = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];
const ENTITY_SET_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
function isImportType(value) {
    return ENTITY_KEYS.includes(value);
}
/**
 * Normalize one entity-set name. Empty / whitespace → clear (use contract default).
 */
function normalizeEntitySetName(value) {
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
        throw Object.assign(new Error(`Invalid Priority table name "${trimmed}" (use letters, digits, underscore)`), { statusCode: 400, code: "INVALID_ENTITY_SET" });
    }
    return trimmed;
}
function parseEntitySetsMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
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
function mergeEntitySetsPatch(existing, patch) {
    const base = parseEntitySetsMap(existing);
    if (!patch) {
        return base;
    }
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (!isImportType(key)) {
            continue;
        }
        if (value === undefined) {
            continue;
        }
        const normalized = normalizeEntitySetName(value);
        if (normalized === null || normalized === undefined) {
            delete next[key];
        }
        else {
            next[key] = normalized;
        }
    }
    return next;
}
function entitySetsToPrismaJson(map) {
    return map;
}
function resolveEntityCollectionPath(importType, entitySets) {
    if (!(0, priorityApiContract_1.isPriorityEntityImportType)(importType)) {
        throw new Error(`Unsupported import type: ${importType}`);
    }
    const override = entitySets?.[importType]?.trim();
    if (override) {
        return override;
    }
    return (0, priorityApiContract_1.getPriorityEntityEndpoint)(importType).path;
}
function parseEntitySetCatalog(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const names = [];
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
function entitySetCatalogToPrismaJson(names) {
    return names;
}
/** Import types whose entity-set override string changed. */
function listChangedEntitySetEntities(params) {
    const prev = parseEntitySetsMap(params.existing);
    const changed = [];
    for (const key of ENTITY_KEYS) {
        const before = prev[key] ?? "";
        const after = params.next[key] ?? "";
        if (before !== after) {
            changed.push(key);
        }
    }
    return changed;
}
function getDefaultEntitySets() {
    return {
        Customer: (0, priorityApiContract_1.getPriorityEntityEndpoint)("Customer").path,
        Contact: (0, priorityApiContract_1.getPriorityEntityEndpoint)("Contact").path,
        Invoice: (0, priorityApiContract_1.getPriorityEntityEndpoint)("Invoice").path,
        Payment: (0, priorityApiContract_1.getPriorityEntityEndpoint)("Payment").path,
    };
}
