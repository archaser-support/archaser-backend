import { getFieldOutputKey } from "./report.constants";
import { getFormulaOutputKey, ReportFormula } from "./report-formula/types";
import { formatAggregatedFormulaValue } from "./report-formula/formula-execution";
import { formatMoneyIso } from "./format-money.util";

export type AggregationType = "SUM" | "AVG" | "COUNT" | "MIN" | "MAX";

export type GroupingField = {
    table: string;
    field: string;
    alias?: string;
    aggregation?: string;
};

export type GroupingReportConfig = {
    fields?: GroupingField[];
    grouping?: string[];
    formulas?: ReportFormula[];
};

export function getLegacyFieldOutputKey(field: GroupingField): string {
    return field.alias || `${field.table}.${field.field}`;
}

export function isAggregatedField(field: GroupingField): boolean {
    return !!(field.aggregation && field.aggregation !== "");
}

export function reportNeedsGroupedExecution(
    config: GroupingReportConfig
): boolean {
    const hasGrouping =
        Array.isArray(config.grouping) && config.grouping.length > 0;
    const hasAggregations = (config.fields || []).some((field) =>
        isAggregatedField(field)
    );
    return hasGrouping || hasAggregations;
}

export function coerceToNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value === "number") {
        return Number.isNaN(value) ? null : value;
    }
    if (typeof value === "bigint") {
        const n = Number(value);
        return Number.isNaN(n) ? null : n;
    }
    if (typeof value === "object") {
        const obj = value as {
            toNumber?: () => number;
            toString?: () => string;
        };
        if (typeof obj.toNumber === "function") {
            const n = obj.toNumber();
            return typeof n === "number" && !Number.isNaN(n) ? n : null;
        }
        if (typeof obj.toString === "function") {
            const n = parseFloat(obj.toString());
            return Number.isNaN(n) ? null : n;
        }
    }
    const n = parseFloat(String(value));
    return Number.isNaN(n) ? null : n;
}

export function calculateAggregation(
    values: number[],
    aggregation: string
): number | null {
    const numValues = values.filter((v) => !Number.isNaN(v));
    if (numValues.length === 0) {
        return null;
    }
    switch (String(aggregation || "").toUpperCase()) {
        case "SUM":
            return numValues.reduce((sum, val) => sum + val, 0);
        case "AVG":
            return (
                numValues.reduce((sum, val) => sum + val, 0) / numValues.length
            );
        case "COUNT":
            return numValues.length;
        case "MIN":
            return Math.min(...numValues);
        case "MAX":
            return Math.max(...numValues);
        default:
            return null;
    }
}

function extractAggregationSourceValue(
    row: Record<string, unknown>,
    outputKey: string,
    legacyKey: string | null
): number | null {
    const raw =
        row.raw && typeof row.raw === "object"
            ? (row.raw as Record<string, unknown>)
            : undefined;
    const candidates = [
        row[outputKey],
        ...(legacyKey ? [row[legacyKey]] : []),
        ...(raw ? [raw[outputKey]] : []),
        ...(raw && legacyKey ? [raw[legacyKey]] : []),
    ];
    for (const value of candidates) {
        const n = coerceToNumber(value);
        if (n !== null) {
            return n;
        }
    }
    return null;
}

function shouldFormatFieldAsCurrency(table: string, field: string): boolean {
    const lower = field.toLowerCase();
    return (
        lower === "amount" ||
        lower.endsWith("_amount") ||
        lower.includes("amount") ||
        lower === "outstanding_debt" ||
        lower === "total_due" ||
        lower === "approved_limit"
    ) && !(table === "Customer" && lower.includes("cost"));
}

/** Row key prefix for per-field display currency (set during formatRow). */
export const REPORT_FIELD_CURRENCY_PREFIX = "__currency_";

/** Marker on grouped rows when a money aggregation mixes currencies. */
export const MIXED_CURRENCY_MARKER_PREFIX = "___mixed_currency_";

export function mixedCurrencyMarkerKey(outputKey: string): string {
    return `${MIXED_CURRENCY_MARKER_PREFIX}${outputKey}`;
}

export function fieldCurrencyKey(outputKey: string): string {
    return `${REPORT_FIELD_CURRENCY_PREFIX}${outputKey}`;
}

function resolveCurrencyFromRow(
    sampleRow: Record<string, unknown> | undefined,
    accountCurrency: string
): string {
    if (!sampleRow) {
        return accountCurrency || "USD";
    }
    const candidates = [
        sampleRow.customer_currency,
        sampleRow.currency,
        sampleRow["Customer.customer_currency"],
        sampleRow["Invoice.customer_currency"],
        sampleRow["Invoice.currency"],
    ];
    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
            return value.trim().toUpperCase();
        }
    }
    return accountCurrency || "USD";
}

/**
 * Unique display currencies across group detail rows for a money field.
 * Prefers `__currency_<fieldKey>` from formatRow; falls back to row currency fields.
 */
export function collectUniqueCurrenciesForField(
    rows: Record<string, unknown>[],
    outputKey: string,
    legacyKey: string | null,
    accountCurrency: string
): string[] {
    const currencies = new Set<string>();
    for (const row of rows) {
        const fromMeta =
            row[fieldCurrencyKey(outputKey)] ??
            (legacyKey ? row[fieldCurrencyKey(legacyKey)] : undefined);
        if (typeof fromMeta === "string" && fromMeta.trim()) {
            currencies.add(fromMeta.trim().toUpperCase());
            continue;
        }
        currencies.add(resolveCurrencyFromRow(row, accountCurrency));
    }
    return Array.from(currencies);
}

/**
 * Shared money-aggregation rule (also for planned total row): one currency →
 * keep the total; mixed → empty value + marker (grid shows "—", export blank).
 */
export function resolveMoneyAggregationCurrency(
    rows: Record<string, unknown>[],
    outputKey: string,
    legacyKey: string | null,
    accountCurrency: string
): { currency: string } | { mixed: true } {
    const unique = collectUniqueCurrenciesForField(
        rows,
        outputKey,
        legacyKey,
        accountCurrency
    );
    if (unique.length > 1) {
        return { mixed: true };
    }
    return {
        currency: unique[0] || accountCurrency || "USD",
    };
}

function formatCurrencyValue(
    amount: number,
    currency: string,
    locale: string
): string {
    return formatMoneyIso(amount, currency, locale);
}

/**
 * Group formatted rows and compute aggregation output keys
 * (`Invoice.amount__COUNT`, `Invoice.amount__SUM`, …).
 */
export function applyGroupingAndAggregation(
    rows: Record<string, unknown>[],
    config: GroupingReportConfig,
    options?: {
        locale?: string;
        accountCurrency?: string;
    }
): Record<string, unknown>[] {
    const fields = config.fields || [];
    const groupingKeys = config.grouping || [];
    const aggregatedFields = fields.filter((field) => isAggregatedField(field));
    const aggregatedFormulas = (config.formulas || []).filter(
        (formula) => !!formula.aggregation
    );
    const hasAggregatedFields = aggregatedFields.length > 0;
    const hasGrouping = groupingKeys.length > 0;

    if (!hasGrouping && !hasAggregatedFields) {
        return rows;
    }

    const groups = new Map<string, Record<string, unknown>[]>();
    for (const row of rows) {
        const groupKey = hasGrouping
            ? groupingKeys
                  .map((key) => {
                      const value = row[key];
                      return value === undefined ? "__undefined__" : String(value);
                  })
                  .join("|")
            : "__all__";
        const existing = groups.get(groupKey);
        if (existing) {
            existing.push(row);
        } else {
            groups.set(groupKey, [row]);
        }
    }

    const locale = options?.locale || "en-US";
    const accountCurrency = options?.accountCurrency || "USD";
    const groupedRows: Record<string, unknown>[] = [];

    for (const [groupKey, groupRows] of Array.from(groups.entries())) {
        const sampleRow = groupRows[0];
        const groupedRow: Record<string, unknown> = {
            id: `group-${groupKey}`,
        };

        for (const groupingKey of groupingKeys) {
            groupedRow[groupingKey] = sampleRow?.[groupingKey] ?? null;
            const gfk = `___formatted_${groupingKey}`;
            if (sampleRow?.[gfk] !== undefined && sampleRow?.[gfk] !== null) {
                groupedRow[gfk] = sampleRow[gfk];
            }
            const linkKey = `__link_${groupingKey}`;
            if (sampleRow?.[linkKey] != null) {
                groupedRow[linkKey] = sampleRow[linkKey];
            }
        }

        if (sampleRow?.customer_id != null) {
            groupedRow.customer_id = sampleRow.customer_id;
        }
        if (sampleRow?.parent_customer_id != null) {
            groupedRow.parent_customer_id = sampleRow.parent_customer_id;
        }
        if (sampleRow?.name != null) {
            groupedRow.name = sampleRow.name;
        }

        for (const field of aggregatedFields) {
            const outputKey = getFieldOutputKey(field);
            const legacyKey =
                field.aggregation && !field.alias
                    ? getLegacyFieldOutputKey(field)
                    : null;
            const values = groupRows
                .map((row) =>
                    extractAggregationSourceValue(row, outputKey, legacyKey)
                )
                .filter((value): value is number => value !== null);

            if (String(field.aggregation).toUpperCase() === "COUNT") {
                groupedRow[outputKey] = values.length;
            } else {
                groupedRow[outputKey] = calculateAggregation(
                    values,
                    String(field.aggregation)
                );
            }

            if (
                String(field.aggregation).toUpperCase() !== "COUNT" &&
                shouldFormatFieldAsCurrency(field.table, field.field)
            ) {
                const moneyCurrency = resolveMoneyAggregationCurrency(
                    groupRows,
                    outputKey,
                    legacyKey,
                    accountCurrency
                );
                if ("mixed" in moneyCurrency) {
                    // Do not add different currencies together; blank grid + export.
                    groupedRow[outputKey] = null;
                    groupedRow[`___formatted_${outputKey}`] = null;
                    groupedRow[mixedCurrencyMarkerKey(outputKey)] = true;
                } else {
                    const numVal = coerceToNumber(groupedRow[outputKey]);
                    if (numVal !== null) {
                        groupedRow[`___formatted_${outputKey}`] =
                            formatCurrencyValue(
                                numVal,
                                moneyCurrency.currency,
                                locale
                            );
                        groupedRow[fieldCurrencyKey(outputKey)] =
                            moneyCurrency.currency;
                    }
                }
            } else if (String(field.aggregation).toUpperCase() === "COUNT") {
                const countVal = coerceToNumber(groupedRow[outputKey]);
                if (countVal !== null) {
                    try {
                        groupedRow[`___formatted_${outputKey}`] =
                            new Intl.NumberFormat(locale).format(countVal);
                    } catch {
                        groupedRow[`___formatted_${outputKey}`] =
                            String(countVal);
                    }
                }
            }
        }

        for (const formula of aggregatedFormulas) {
            const outputKey = getFormulaOutputKey(formula.id);
            const values = groupRows
                .map((row) => coerceToNumber(row[outputKey]))
                .filter((value): value is number => value !== null);
            const aggregated = calculateAggregation(
                values,
                String(formula.aggregation)
            );

            if (formula.format === "currency" && aggregated !== null) {
                const moneyCurrency = resolveMoneyAggregationCurrency(
                    groupRows,
                    outputKey,
                    null,
                    accountCurrency
                );
                if ("mixed" in moneyCurrency) {
                    groupedRow[outputKey] = null;
                    groupedRow[`___formatted_${outputKey}`] = null;
                    groupedRow[mixedCurrencyMarkerKey(outputKey)] = true;
                    continue;
                }
                groupedRow[outputKey] = aggregated;
                groupedRow[`___formatted_${outputKey}`] =
                    formatCurrencyValue(
                        aggregated,
                        moneyCurrency.currency,
                        locale
                    );
                groupedRow[fieldCurrencyKey(outputKey)] =
                    moneyCurrency.currency;
                continue;
            }

            groupedRow[outputKey] = aggregated;
            groupedRow[`___formatted_${outputKey}`] =
                aggregated === null
                    ? null
                    : formatAggregatedFormulaValue(
                          aggregated,
                          formula,
                          sampleRow ?? {},
                          fields,
                          locale,
                          accountCurrency
                      );
        }

        groupedRows.push(groupedRow);
    }

    return groupedRows;
}

/**
 * Full-dataset totals for aggregated columns (before pagination).
 * Used by the viewer column headers so SUM/AVG/MIN/MAX/COUNT reflect every
 * matching group row, not only the page currently loaded in the grid.
 */
export function buildAggregationTotals(
    rows: Record<string, unknown>[],
    fields: GroupingField[]
): Record<string, number> | undefined {
    const totals: Record<string, number> = {};
    for (const field of fields) {
        const aggregation = String(field.aggregation || "").toUpperCase();
        if (
            aggregation !== "SUM" &&
            aggregation !== "AVG" &&
            aggregation !== "COUNT" &&
            aggregation !== "MIN" &&
            aggregation !== "MAX"
        ) {
            continue;
        }
        const outputKey = getFieldOutputKey(field);
        const legacyKey = getLegacyFieldOutputKey(field);
        const values = rows
            .map((row) => coerceToNumber(row[outputKey]))
            .filter((value): value is number => value !== null);
        if (values.length === 0) {
            continue;
        }
        // COUNT/SUM: sum of per-group values. AVG/MIN/MAX: over group values
        // (same rollup the viewer used to compute from loaded rows only).
        const total =
            aggregation === "COUNT" || aggregation === "SUM"
                ? values.reduce((sum, value) => sum + value, 0)
                : calculateAggregation(values, aggregation);
        if (total !== null) {
            totals[outputKey] = total;
            // Case-normalized suffix + legacy/alias keys so the viewer header
            // lookup cannot miss on casing or older columnOrder values.
            const normalizedKey = outputKey.replace(
                /__(sum|avg|count|min|max)$/i,
                (_m, agg: string) => `__${String(agg).toUpperCase()}`
            );
            if (normalizedKey !== outputKey) {
                totals[normalizedKey] = total;
            }
            if (legacyKey && legacyKey !== outputKey) {
                totals[legacyKey] = total;
            }
        }
    }
    return Object.keys(totals).length > 0 ? totals : undefined;
}

export function compareSortValues(
    aValue: unknown,
    bValue: unknown,
    isAsc: boolean
): number {
    if (aValue === null || aValue === undefined || aValue === "") {
        return isAsc ? 1 : -1;
    }
    if (bValue === null || bValue === undefined || bValue === "") {
        return isAsc ? -1 : 1;
    }
    const comparison =
        typeof aValue === "string" && typeof bValue === "string"
            ? aValue.localeCompare(bValue)
            : aValue > bValue
              ? 1
              : aValue < bValue
                ? -1
                : 0;
    return isAsc ? comparison : -comparison;
}

export function detectOneToManyRelationTable(
    primaryTable: string,
    fields: GroupingField[],
    relationMap: Record<string, string>,
    sampleRow?: Record<string, unknown>
): { table: string; relationName: string } | null {
    const nonPrimary = fields.filter(
        (f) => f.table !== primaryTable && !f.field.includes(".")
    );
    for (const field of nonPrimary) {
        const relationName = relationMap[field.table];
        if (!relationName) {
            continue;
        }
        if (sampleRow) {
            const value = sampleRow[relationName];
            if (Array.isArray(value)) {
                return { table: field.table, relationName };
            }
            continue;
        }
        // Without a sample, treat known list targets used by reports as to-many.
        if (
            (primaryTable === "Customer" &&
                (field.table === "Invoice" ||
                    field.table === "InvoicePayment" ||
                    field.table === "Contact" ||
                    field.table === "Activity" ||
                    field.table === "CustomerPolicy")) ||
            (primaryTable === "Invoice" && field.table === "InvoicePayment")
        ) {
            return { table: field.table, relationName };
        }
    }
    return null;
}
