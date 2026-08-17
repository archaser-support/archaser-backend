"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PULL_FILTER_OPERATORS = void 0;
exports.parsePullFiltersMap = parsePullFiltersMap;
exports.mergePullFiltersPatch = mergePullFiltersPatch;
exports.pullFiltersToPrismaJson = pullFiltersToPrismaJson;
exports.listChangedPullFilterEntities = listChangedPullFilterEntities;
exports.toPublicPullFilters = toPublicPullFilters;
exports.resolveEntityPullFilterOData = resolveEntityPullFilterOData;
const billingConnectorPullFilterCompile_1 = require("./billingConnectorPullFilterCompile");
exports.PULL_FILTER_OPERATORS = [
    "eq",
    "ne",
    "startswith",
    "contains",
    "gt",
    "lt",
];
const ENTITY_KEYS = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];
const OPERATOR_SET = new Set(exports.PULL_FILTER_OPERATORS);
function isImportType(value) {
    return ENTITY_KEYS.includes(value);
}
function isPullFilterOperator(value) {
    return OPERATOR_SET.has(value);
}
function isAdvancedConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const row = value;
    return row.mode === "advanced" && typeof row.odata === "string";
}
function isRulesConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const row = value;
    return row.mode === "rules" && Array.isArray(row.rules);
}
function normalizeRules(rules) {
    const normalized = [];
    for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
            continue;
        }
        const row = rule;
        const field = String(row.field ?? "").trim();
        const operatorRaw = String(row.operator ?? "").trim();
        if (!field || !isPullFilterOperator(operatorRaw)) {
            continue;
        }
        normalized.push({
            field,
            operator: operatorRaw,
            value: String(row.value ?? ""),
        });
    }
    return normalized;
}
function normalizeConfig(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (isAdvancedConfig(value)) {
        const odata = value.odata.trim();
        return odata ? { mode: "advanced", odata } : null;
    }
    if (isRulesConfig(value)) {
        const rules = normalizeRules(value.rules);
        return rules.length > 0 ? { mode: "rules", rules } : null;
    }
    return null;
}
function parsePullFiltersMap(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!isImportType(key)) {
            continue;
        }
        const normalized = normalizeConfig(value);
        if (normalized) {
            out[key] = normalized;
        }
    }
    return out;
}
function mergePullFiltersPatch(existing, patch) {
    const base = parsePullFiltersMap(existing);
    if (!patch) {
        return base;
    }
    const next = { ...base };
    for (const key of ENTITY_KEYS) {
        if (!(key in patch)) {
            continue;
        }
        const normalized = normalizeConfig(patch[key]);
        if (normalized) {
            next[key] = normalized;
        }
        else {
            delete next[key];
        }
    }
    return next;
}
function pullFiltersToPrismaJson(map) {
    return map;
}
function listChangedPullFilterEntities(params) {
    const prev = parsePullFiltersMap(params.existing);
    const changed = [];
    for (const key of ENTITY_KEYS) {
        const before = JSON.stringify(prev[key] ?? null);
        const after = JSON.stringify(params.next[key] ?? null);
        if (before !== after) {
            changed.push(key);
        }
    }
    return changed;
}
function toPublicPullFilters(raw) {
    const pull_filters = parsePullFiltersMap(raw);
    const effective_pull_filters = {};
    for (const key of ENTITY_KEYS) {
        effective_pull_filters[key] = (0, billingConnectorPullFilterCompile_1.compileEntityPullFilter)(pull_filters[key]);
    }
    return { pull_filters, effective_pull_filters };
}
function resolveEntityPullFilterOData(raw, importType) {
    const map = parsePullFiltersMap(raw);
    return (0, billingConnectorPullFilterCompile_1.compileEntityPullFilter)(map[importType]);
}
