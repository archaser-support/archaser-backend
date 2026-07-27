"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coerceDateTimeBound = coerceDateTimeBound;
exports.operatorToPrisma = operatorToPrisma;
exports.splitFiltersByTable = splitFiltersByTable;
exports.mergeAndWhere = mergeAndWhere;
const report_virtual_fields_util_1 = require("./report-virtual-fields.util");
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function coerceValue(value) {
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === "string" && /^-?\d+$/.test(value)) {
        const n = Number(value);
        if (Number.isSafeInteger(n)) {
            return n;
        }
    }
    return value;
}
function coerceDateTimeBound(value, bound) {
    if (typeof value === "string" && YMD_RE.test(value)) {
        return new Date(value + (bound === "end" ? "T23:59:59.999Z" : "T00:00:00.000Z"));
    }
    if (typeof value === "string" && value.includes("T")) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? value : d;
    }
    if (value instanceof Date) {
        return value;
    }
    return coerceValue(value);
}
function isYmdString(value) {
    return typeof value === "string" && YMD_RE.test(value);
}
function operatorToPrisma(operator, value) {
    const op = (operator || "equals").toLowerCase();
    const v = coerceValue(value);
    switch (op) {
        case "=":
        case "equals":
            if (isYmdString(v)) {
                return {
                    gte: coerceDateTimeBound(v, "start"),
                    lte: coerceDateTimeBound(v, "end"),
                };
            }
            return { equals: coerceDateTimeBound(v, "start") };
        case "!=":
        case "not_equals":
        case "not":
            return { not: coerceDateTimeBound(v, "start") };
        case ">":
        case "greater_than":
            return { gt: coerceDateTimeBound(v, "start") };
        case ">=":
        case "greater_than_or_equal":
            return { gte: coerceDateTimeBound(v, "start") };
        case "<":
        case "less_than":
            return { lt: coerceDateTimeBound(v, "end") };
        case "<=":
        case "less_than_or_equal":
            return { lte: coerceDateTimeBound(v, "end") };
        case "contains":
            return { contains: String(v ?? ""), mode: "insensitive" };
        case "starts_with":
            return { startsWith: String(v ?? ""), mode: "insensitive" };
        case "ends_with":
            return { endsWith: String(v ?? ""), mode: "insensitive" };
        case "in": {
            const arr = Array.isArray(v)
                ? v.map((item) => coerceDateTimeBound(item, "start"))
                : String(v ?? "")
                    .split(",")
                    .map((s) => coerceDateTimeBound(s.trim(), "start"));
            return { in: arr };
        }
        case "is_null":
        case "isnull":
            return { equals: null };
        case "is_not_null":
        case "isnotnull":
            return { not: null };
        case "between": {
            if (Array.isArray(v) && v.length >= 2) {
                const start = coerceDateTimeBound(v[0], "start");
                const end = coerceDateTimeBound(v[1], "end");
                if (start === "" ||
                    start == null ||
                    end === "" ||
                    end == null) {
                    return null;
                }
                return { gte: start, lte: end };
            }
            return null;
        }
        default:
            return { equals: coerceDateTimeBound(v, "start") };
    }
}
function splitFiltersByTable(filters, primaryTable, options = {}) {
    const primary = {};
    const nested = {};
    const skip = options.skipFields;
    for (const f of filters) {
        if (!f?.table || !f?.field) {
            continue;
        }
        if (skip?.has(f.field)) {
            continue;
        }
        if (f.field.startsWith("__")) {
            continue;
        }
        const clause = operatorToPrisma(f.operator, f.value);
        if (!clause) {
            continue;
        }
        if (f.table === primaryTable) {
            if ((0, report_virtual_fields_util_1.isComputedReportField)(primaryTable, f.field) ||
                (!f.field.includes(".") &&
                    !(0, report_virtual_fields_util_1.isPrismaScalarField)(primaryTable, f.field))) {
                continue;
            }
            primary[f.field] = clause;
        }
        else {
            if ((0, report_virtual_fields_util_1.isComputedReportField)(f.table, f.field) ||
                (!f.field.includes(".") &&
                    !(0, report_virtual_fields_util_1.isPrismaScalarField)(f.table, f.field))) {
                continue;
            }
            if (!nested[f.table]) {
                nested[f.table] = {};
            }
            nested[f.table][f.field] = clause;
        }
    }
    return { primary, nested };
}
function mergeAndWhere(...parts) {
    const and = [];
    for (const p of parts) {
        if (p && Object.keys(p).length > 0) {
            and.push(p);
        }
    }
    if (and.length === 0) {
        return {};
    }
    if (and.length === 1) {
        return and[0];
    }
    return { AND: and };
}
//# sourceMappingURL=report-filter.util.js.map