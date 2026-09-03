"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PULL_FILTER_OPERATORS = void 0;
exports.parsePullFiltersMap = parsePullFiltersMap;
exports.mergePullFiltersPatch = mergePullFiltersPatch;
exports.pullFiltersToPrismaJson = pullFiltersToPrismaJson;
exports.listChangedPullFilterEntities = listChangedPullFilterEntities;
exports.toPublicPullFilters = toPublicPullFilters;
exports.resolveEntityPullFilterOData = resolveEntityPullFilterOData;
exports.resolveRelatedCustomerPullFilterOData = resolveRelatedCustomerPullFilterOData;
exports.resolveImportPullFilterOData = resolveImportPullFilterOData;
exports.resolveRuntimeCustomerScopeOData = resolveRuntimeCustomerScopeOData;
exports.compileRuntimeCustomerNumberOData = compileRuntimeCustomerNumberOData;
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
    "tolower",
    "toupper",
]);
function isCustnameField(field) {
    return field.trim().toUpperCase() === "CUSTNAME";
}
/**
 * Customer $filter that is safe to AND onto Invoice / Payment / Contact.
 * Those entities share CUSTNAME; customer-only fields (CDES, …) would 400.
 */
function resolveRelatedCustomerPullFilterOData(raw) {
    const map = parsePullFiltersMap(raw);
    const config = map.Customer;
    if (!config) {
        return null;
    }
    if (config.mode === "rules") {
        if (config.rules.length === 0 ||
            !config.rules.every((rule) => isCustnameField(rule.field))) {
            return null;
        }
        return (0, billingConnectorPullFilterCompile_1.compileEntityPullFilter)(config);
    }
    const withoutLiterals = config.odata.replace(/'([^']|'')*'/g, "''");
    const identifiers = withoutLiterals.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    const fields = identifiers.filter((token) => !ODATA_KEYWORDS.has(token.toLowerCase()));
    if (fields.length === 0 || !fields.every(isCustnameField)) {
        return null;
    }
    return (0, billingConnectorPullFilterCompile_1.compileEntityPullFilter)(config);
}
/**
 * OData $filter for a live import pull: the entity's own pull filter, plus a
 * CUSTNAME-only Customer filter on related entities so invoices/payments/
 * contacts stay inside the same customer subset.
 *
 * Optional Start-backfill `runtimeCustomerNumber` is AND-ed with the entity's
 * ERP customer column (`IDG_CUSTNAME` on IDG_ARFNCITEMS* payment tables,
 * otherwise `CUSTNAME`) so customer-scoped pulls do not page the full table.
 */
function resolveImportPullFilterOData(raw, importType, options) {
    const entityFilter = resolveEntityPullFilterOData(raw, importType);
    const runtimeScope = resolveRuntimeCustomerScopeOData({
        customerNumber: options?.runtimeCustomerNumber,
        additionalCustomerNumbers: options?.additionalCustomerNumbers,
        entityType: importType,
        entitySet: options?.entitySet,
    });
    if (importType !== "Invoice" &&
        importType !== "Payment" &&
        importType !== "Contact") {
        return (0, billingConnectorPullFilterCompile_1.andODataFilters)(entityFilter, runtimeScope);
    }
    return (0, billingConnectorPullFilterCompile_1.andODataFilters)(resolveRelatedCustomerPullFilterOData(raw), entityFilter, runtimeScope);
}
/**
 * ERP customer-number $filter for Start backfill customer scope.
 * IDG payment tables (e.g. IDG_ARFNCITEMS4) use IDG_CUSTNAME; standard
 * Priority Customer/Contact/Invoice/Payment sets use CUSTNAME.
 *
 * When `additionalCustomerNumbers` is set (account extensions), builds
 * `(field eq 'A' or field eq 'B' or …)`.
 */
function resolveRuntimeCustomerScopeOData(params) {
    if (typeof params.customerNumber !== "string") {
        return null;
    }
    const trimmed = params.customerNumber.trim();
    if (!trimmed) {
        return null;
    }
    const field = runtimeCustomerScopeField(params.entityType, params.entitySet);
    const values = new Set([trimmed]);
    for (const extra of params.additionalCustomerNumbers ?? []) {
        if (typeof extra !== "string") {
            continue;
        }
        const value = extra.trim();
        if (value) {
            values.add(value);
        }
    }
    const clauses = [...values].map((value) => `${field} eq ${(0, billingConnectorPullFilterCompile_1.escapeODataStringLiteral)(value)}`);
    if (clauses.length === 1) {
        return clauses[0] ?? null;
    }
    return `(${clauses.join(" or ")})`;
}
function runtimeCustomerScopeField(entityType, entitySet) {
    const setName = (entitySet ?? "").trim().toUpperCase();
    if (entityType === "Payment" &&
        (setName.includes("IDG_ARFNCITEMS") || setName.startsWith("IDG_"))) {
        return "IDG_CUSTNAME";
    }
    return "CUSTNAME";
}
/**
 * @deprecated Prefer {@link resolveRuntimeCustomerScopeOData} with entityType /
 * entitySet so IDG payment tables filter on IDG_CUSTNAME.
 */
function compileRuntimeCustomerNumberOData(customerNumber, entityType = "Invoice", entitySet) {
    return resolveRuntimeCustomerScopeOData({
        customerNumber,
        entityType,
        entitySet,
    });
}
