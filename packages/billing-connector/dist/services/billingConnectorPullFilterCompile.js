"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileEntityPullFilter = compileEntityPullFilter;
function andODataFilters(...parts) {
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
function escapeODataStringLiteral(value) {
    return `'${value.replace(/'/g, "''")}'`;
}
function formatComparisonLiteral(value) {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return trimmed;
    }
    if (/^\d{4}-\d{2}-\d{2}(T[\d:.+-]+Z?)?$/.test(trimmed)) {
        return trimmed;
    }
    return escapeODataStringLiteral(trimmed);
}
function compilePullFilterRule(rule) {
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
function compileEntityPullFilter(config) {
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
            .filter((part) => Boolean(part));
        return andODataFilters(...parts);
    }
    return null;
}
