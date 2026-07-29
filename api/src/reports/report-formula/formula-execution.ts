import { Prisma } from "@prisma/client";
import { getFieldOutputKey } from "../report.constants";
import {
    getDirectFieldReferences,
    getDirectFormulaDependencyIds,
    topologicalSortFormulas,
} from "./formula-dependencies";
import {
    decimalToNumberOrNull,
    evaluateFormulaExpression,
} from "./formula-engine";
import {
    extractFieldReferences,
    isFormulaOperandReference,
} from "./parser";
import {
    FormulaWarningSummary,
    getFormulaOutputKey,
    ReportFormula,
} from "./types";

export type FormulaField = {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
};

export type FormulaReportConfig = {
    tables?: string[];
    fields?: FormulaField[];
    formulas?: ReportFormula[];
};

export type FormulaMetadataTable = {
    name: string;
    fields: Array<{ name: string; type: string }>;
};

const AGGREGATIONS = ["SUM", "AVG", "MIN", "MAX", "COUNT"];

function isFormulaOperandFieldType(type?: string): boolean {
    return ["number", "decimal", "integer", "amount", "currency", "percentage"].includes(
        (type || "").toLowerCase()
    );
}

function candidateKeys(reference: string, fields: FormulaField[]): string[] {
    const keys = [reference, ...AGGREGATIONS.map((agg) => `${reference}__${agg}`)];
    for (const field of fields) {
        if (`${field.table}.${field.field}` !== reference) {
            continue;
        }
        keys.push(getFieldOutputKey(field));
    }
    return [...new Set(keys)];
}

function getRowFieldValue(
    row: Record<string, unknown>,
    reference: string,
    fields: FormulaField[]
): unknown {
    const keys = candidateKeys(reference, fields);
    const raw =
        row.raw && typeof row.raw === "object"
            ? (row.raw as Record<string, unknown>)
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

function isCurrencySource(
    reference: string,
    metadataTables: FormulaMetadataTable[]
): boolean {
    const dot = reference.indexOf(".");
    if (dot <= 0) {
        return false;
    }
    const table = metadataTables.find(
        (entry) => entry.name === reference.slice(0, dot)
    );
    const fieldName = reference.slice(dot + 1);
    const field = table?.fields.find((entry) => entry.name === fieldName);
    const type = field?.type.toLowerCase();
    return (
        type === "amount" ||
        type === "currency" ||
        fieldName.toLowerCase().includes("amount")
    );
}

function resolveCurrencySources(
    formulas: ReportFormula[],
    metadataTables: FormulaMetadataTable[]
): ReportFormula[] {
    const resolvedById = new Map<string, ReportFormula>();
    const sourcesById = new Map<string, string>();
    for (const formula of topologicalSortFormulas(formulas)) {
        if (formula.format !== "currency") {
            resolvedById.set(formula.id, formula);
            continue;
        }
        let currencySource = extractFieldReferences(formula.expression).find(
            (reference) =>
                !isFormulaOperandReference(reference) &&
                isCurrencySource(reference, metadataTables)
        );
        if (!currencySource) {
            const inherited = new Set(
                getDirectFormulaDependencyIds(formula.expression)
                    .map((id) => sourcesById.get(id))
                    .filter((source): source is string => !!source)
            );
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

function resolveCurrency(
    row: Record<string, unknown>,
    source: string | undefined,
    fields: FormulaField[],
    accountCurrency: string
): string {
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

function formatFormulaValue(
    value: Prisma.Decimal | null,
    formula: ReportFormula,
    row: Record<string, unknown>,
    fields: FormulaField[],
    locale: string,
    accountCurrency: string
): { raw: number | null; formatted: string | null } {
    const raw = decimalToNumberOrNull(value);
    if (raw === null) {
        return { raw: null, formatted: null };
    }
    try {
        if (formula.format === "currency") {
            return {
                raw,
                formatted: new Intl.NumberFormat(locale, {
                    style: "currency",
                    currency: resolveCurrency(
                        row,
                        formula.currencySource,
                        fields,
                        accountCurrency
                    ),
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
    } catch {
        return { raw, formatted: String(raw) };
    }
}

export function mergeFormulaOperandFieldsIntoConfig<
    T extends FormulaReportConfig,
>(config: T, metadataTables: FormulaMetadataTable[]): T {
    if (!config.formulas?.length) {
        return config;
    }
    const reportTables = new Set(config.tables || []);
    const fields = [...(config.fields || [])];
    const existing = new Set(
        fields.map((field) => `${field.table}.${field.field}`)
    );

    const addReference = (reference: string) => {
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
        if (
            metadata &&
            isFormulaOperandFieldType(metadata.type) &&
            !existing.has(reference)
        ) {
            fields.push({ table: tableName, field: fieldName });
            existing.add(reference);
        }
    };

    for (const formula of config.formulas) {
        getDirectFieldReferences(formula.expression).forEach(addReference);
        if (formula.currencySource) {
            addReference(
                formula.currencySource.replace(
                    /__(SUM|AVG|MIN|MAX|COUNT)$/,
                    ""
                )
            );
        }
    }
    return { ...config, fields };
}

export function applyFormulasToRows(
    rows: Record<string, unknown>[],
    config: FormulaReportConfig,
    options: {
        locale?: string;
        accountCurrency?: string;
        metadataTables: FormulaMetadataTable[];
    }
): {
    rows: Record<string, unknown>[];
    warnings: FormulaWarningSummary[];
} {
    const formulas = config.formulas || [];
    if (formulas.length === 0) {
        return { rows, warnings: [] };
    }

    const fields = config.fields || [];
    const ordered = topologicalSortFormulas(
        resolveCurrencySources(formulas, options.metadataTables)
    );
    const invalidCounts = new Map<string, number>();
    const enriched = rows.map((row) => {
        const output = { ...row };
        for (const formula of ordered) {
            const outputKey = getFormulaOutputKey(formula.id);
            const evaluated = evaluateFormulaExpression(
                formula.expression,
                (reference) => {
                    if (isFormulaOperandReference(reference)) {
                        return output[reference] ?? null;
                    }
                    return getRowFieldValue(output, reference, fields);
                }
            );
            if (evaluated.value === null) {
                if (
                    evaluated.nullReason &&
                    evaluated.nullReason !== "missing_operand"
                ) {
                    invalidCounts.set(
                        formula.id,
                        (invalidCounts.get(formula.id) || 0) + 1
                    );
                }
                output[outputKey] = null;
                output[`___formatted_${outputKey}`] = null;
                continue;
            }
            const formatted = formatFormulaValue(
                evaluated.value,
                formula,
                output,
                fields,
                options.locale || "en-US",
                options.accountCurrency || "USD"
            );
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
