"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeFormulaOperandFieldsIntoConfig = mergeFormulaOperandFieldsIntoConfig;
exports.applyFormulasToRows = applyFormulasToRows;
const report_constants_1 = require("../report.constants");
const formula_dependencies_1 = require("./formula-dependencies");
const formula_engine_1 = require("./formula-engine");
const parser_1 = require("./parser");
const types_1 = require("./types");
const AGGREGATIONS = ["SUM", "AVG", "MIN", "MAX", "COUNT"];
function isFormulaOperandFieldType(type) {
    return ["number", "decimal", "integer", "amount", "currency", "percentage"].includes((type || "").toLowerCase());
}
function candidateKeys(reference, fields) {
    const keys = [reference, ...AGGREGATIONS.map((agg) => `${reference}__${agg}`)];
    for (const field of fields) {
        if (`${field.table}.${field.field}` !== reference) {
            continue;
        }
        keys.push((0, report_constants_1.getFieldOutputKey)(field));
    }
    return [...new Set(keys)];
}
function getRowFieldValue(row, reference, fields) {
    const keys = candidateKeys(reference, fields);
    const raw = row.raw && typeof row.raw === "object"
        ? row.raw
        : undefined;
    const sources = raw ? [row, raw] : [row];
    for (const source of sources) {
        for (const key of keys) {
            const value = source[key];
            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }
    }
    for (const source of sources) {
        for (const key of keys) {
            const value = source[`___formatted_${key}`];
            if (value !== undefined && value !== null && value !== "") {
                return value;
            }
        }
    }
    return undefined;
}
function isCurrencySource(reference, metadataTables) {
    const dot = reference.indexOf(".");
    if (dot <= 0) {
        return false;
    }
    const table = metadataTables.find((entry) => entry.name === reference.slice(0, dot));
    const fieldName = reference.slice(dot + 1);
    const field = table?.fields.find((entry) => entry.name === fieldName);
    const type = field?.type.toLowerCase();
    return (type === "amount" ||
        type === "currency" ||
        fieldName.toLowerCase().includes("amount"));
}
function resolveCurrencySources(formulas, metadataTables) {
    const resolvedById = new Map();
    const sourcesById = new Map();
    for (const formula of (0, formula_dependencies_1.topologicalSortFormulas)(formulas)) {
        if (formula.format !== "currency") {
            resolvedById.set(formula.id, formula);
            continue;
        }
        let currencySource = (0, parser_1.extractFieldReferences)(formula.expression).find((reference) => !(0, parser_1.isFormulaOperandReference)(reference) &&
            isCurrencySource(reference, metadataTables));
        if (!currencySource) {
            const inherited = new Set((0, formula_dependencies_1.getDirectFormulaDependencyIds)(formula.expression)
                .map((id) => sourcesById.get(id))
                .filter((source) => !!source));
            if (inherited.size === 1) {
                currencySource = [...inherited][0];
            }
        }
        const resolved = currencySource
            ? { ...formula, currencySource }
            : { ...formula, currencySource: undefined };
        if (currencySource) {
            sourcesById.set(formula.id, currencySource);
        }
        resolvedById.set(formula.id, resolved);
    }
    return formulas.map((formula) => resolvedById.get(formula.id) || formula);
}
function resolveCurrency(row, source, fields, accountCurrency) {
    if (source) {
        for (const key of candidateKeys(source, fields)) {
            const currency = row[`__currency_${key}`];
            if (currency) {
                return String(currency);
            }
        }
    }
    return row.currency ? String(row.currency) : accountCurrency;
}
function formatFormulaValue(value, formula, row, fields, locale, accountCurrency) {
    const raw = (0, formula_engine_1.decimalToNumberOrNull)(value);
    if (raw === null) {
        return { raw: null, formatted: null };
    }
    try {
        if (formula.format === "currency") {
            return {
                raw,
                formatted: new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: resolveCurrency(row, formula.currencySource, fields, accountCurrency),
                }).format(raw),
            };
        }
        if (formula.format === "percentage") {
            return {
                raw,
                formatted: new Intl.NumberFormat(locale, {
                    style: "percent",
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                }).format(raw),
            };
        }
        return {
            raw,
            formatted: new Intl.NumberFormat(locale, {
                maximumFractionDigits: 10,
            }).format(raw),
        };
    }
    catch {
        return { raw, formatted: String(raw) };
    }
}
function mergeFormulaOperandFieldsIntoConfig(config, metadataTables) {
    if (!config.formulas?.length) {
        return config;
    }
    const reportTables = new Set(config.tables || []);
    const fields = [...(config.fields || [])];
    const existing = new Set(fields.map((field) => `${field.table}.${field.field}`));
    const addReference = (reference) => {
        const dot = reference.indexOf(".");
        if (dot <= 0) {
            return;
        }
        const tableName = reference.slice(0, dot);
        const fieldName = reference.slice(dot + 1);
        if (!reportTables.has(tableName)) {
            return;
        }
        const metadata = metadataTables
            .find((table) => table.name === tableName)
            ?.fields.find((field) => field.name === fieldName);
        if (metadata &&
            isFormulaOperandFieldType(metadata.type) &&
            !existing.has(reference)) {
            fields.push({ table: tableName, field: fieldName });
            existing.add(reference);
        }
    };
    for (const formula of config.formulas) {
        (0, formula_dependencies_1.getDirectFieldReferences)(formula.expression).forEach(addReference);
        if (formula.currencySource) {
            addReference(formula.currencySource.replace(/__(SUM|AVG|MIN|MAX|COUNT)$/, ""));
        }
    }
    return { ...config, fields };
}
function applyFormulasToRows(rows, config, options) {
    const formulas = config.formulas || [];
    if (formulas.length === 0) {
        return { rows, warnings: [] };
    }
    const fields = config.fields || [];
    const ordered = (0, formula_dependencies_1.topologicalSortFormulas)(resolveCurrencySources(formulas, options.metadataTables));
    const invalidCounts = new Map();
    const enriched = rows.map((row) => {
        const output = { ...row };
        for (const formula of ordered) {
            const outputKey = (0, types_1.getFormulaOutputKey)(formula.id);
            const evaluated = (0, formula_engine_1.evaluateFormulaExpression)(formula.expression, (reference) => {
                if ((0, parser_1.isFormulaOperandReference)(reference)) {
                    return output[reference] ?? null;
                }
                return getRowFieldValue(output, reference, fields);
            });
            if (evaluated.value === null) {
                if (evaluated.nullReason &&
                    evaluated.nullReason !== "missing_operand") {
                    invalidCounts.set(formula.id, (invalidCounts.get(formula.id) || 0) + 1);
                }
                output[outputKey] = null;
                output[`___formatted_${outputKey}`] = null;
                continue;
            }
            const formatted = formatFormulaValue(evaluated.value, formula, output, fields, options.locale || "en-US", options.accountCurrency || "USD");
            output[outputKey] = formatted.raw;
            output[`___formatted_${outputKey}`] = formatted.formatted;
        }
        return output;
    });
    const warnings = formulas
        .map((formula) => ({
        formulaId: formula.id,
        label: formula.label,
        invalidCount: invalidCounts.get(formula.id) || 0,
    }))
        .filter((warning) => warning.invalidCount > 0);
    return { rows: enriched, warnings };
}
//# sourceMappingURL=formula-execution.js.map