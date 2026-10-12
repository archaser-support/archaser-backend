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

/** Customer-currency money (Invoice.customer_amount, …) — not account-currency amounts. */
export function isCustomerCurrencyMoneyField(field: string): boolean {
    const lower = field.toLowerCase();
    return (
        lower.startsWith("customer_") &&
        (lower.includes("amount") ||
            lower.includes("debt") ||
            lower.includes("paid"))
    );
}

/**
 * Per-row currency for grouping and totals. Account-currency amount columns
 * (`Invoice.amount`, …) always use `accountCurrency`; customer-currency
 * columns read the row. Pass `field` so totals do not copy this logic.
 */
export function resolveCurrencyFromRow(
    sampleRow: Record<string, unknown> | undefined,
    accountCurrency: string,
    field?: string
): string {
    if (field && !isCustomerCurrencyMoneyField(field)) {
        return accountCurrency || "USD";
    }
    if (!sampleRow) {
        return accountCurrency || "USD";
    }
    const raw =
        sampleRow.raw && typeof sampleRow.raw === "object"
            ? (sampleRow.raw as Record<string, unknown>)
            : undefined;
    const invoice =
        sampleRow.Invoice && typeof sampleRow.Invoice === "object"
            ? (sampleRow.Invoice as Record<string, unknown>)
            : undefined;
    const candidates = [
        sampleRow.customer_currency,
        sampleRow.currency,
        sampleRow["Customer.customer_currency"],
        sampleRow["Invoice.customer_currency"],
        sampleRow["Invoice.currency"],
        raw?.customer_currency,
        raw?.currency,
        raw?.["Invoice.customer_currency"],
        invoice?.customer_currency,
        invoice?.currency,
    ];
    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) {
            return value.trim().toUpperCase();
        }
    }
    return accountCurrency || "USD";
}

/** Copy row currency companions onto formatted output so totals can see them. */
export function attachRowCurrencyFields(
    out: Record<string, unknown>,
    sourceRow: Record<string, unknown> | undefined,
    primaryTable?: string
): void {
    if (!sourceRow) {
        return;
    }
    const invoice =
        sourceRow.Invoice && typeof sourceRow.Invoice === "object"
            ? (sourceRow.Invoice as Record<string, unknown>)
            : undefined;
    const pick = (...values: unknown[]): string | undefined => {
        for (const value of values) {
            if (typeof value === "string" && value.trim()) {
                return value.trim().toUpperCase();
            }
        }
        return undefined;
    };
    const customerCurrency = pick(
        sourceRow.customer_currency,
        sourceRow["Invoice.customer_currency"],
        sourceRow["InvoicePayment.customer_currency"],
        invoice?.customer_currency
    );
    const currency = pick(
        sourceRow.currency,
        sourceRow["Invoice.currency"],
        invoice?.currency
    );
    if (customerCurrency) {
        if (out.customer_currency == null) {
            out.customer_currency = customerCurrency;
        }
        if (out["Invoice.customer_currency"] == null) {
            out["Invoice.customer_currency"] = customerCurrency;
        }
        if (
            primaryTable === "InvoicePayment" &&
            out["InvoicePayment.customer_currency"] == null
        ) {
            out["InvoicePayment.customer_currency"] = customerCurrency;
        }
    }
    if (currency && out.currency == null) {
        out.currency = currency;
    }
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
                const numVal = coerceToNumber(groupedRow[outputKey]);
                if (numVal !== null) {
                    const currency = resolveCurrencyFromRow(
                        sampleRow,
                        accountCurrency,
                        field.field
                    );
                    groupedRow[`___formatted_${outputKey}`] =
                        formatCurrencyValue(numVal, currency, locale);
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

export type ReportTotalsCell = {
    value: number | null;
    currency?: string;
    mixedCurrency?: boolean;
    formatted?: string;
};

export type ReportTotals = {
    cells: Record<string, ReportTotalsCell>;
    /** Column that carries the "Total" label; null when every column is aggregated. */
    labelKey: string | null;
};

export type TotalRowLabelConfig = GroupingReportConfig & {
    columnOrder?: string[];
};

function isAggregatedFormula(
    formula: Pick<ReportFormula, "aggregation">
): boolean {
    return !!formula.aggregation;
}

export function reportHasTotalsAggregation(
    config: GroupingReportConfig
): boolean {
    const hasFieldAggregation = (config.fields || []).some((field) =>
        isAggregatedField(field)
    );
    if (hasFieldAggregation) {
        return true;
    }
    return (config.formulas || []).some((formula) =>
        isAggregatedFormula(formula)
    );
}

/**
 * First visible column without an aggregation in display order
 * (`columnOrder`, falling back to fields then formulas).
 */
export function resolveTotalRowLabelKey(
    config: TotalRowLabelConfig
): string | null {
    const fields = config.fields || [];
    const visibleFormulas = (config.formulas || []).filter(
        (formula) => !formula.hidden
    );
    const defaultOrder = [
        ...fields.map((field) => getFieldOutputKey(field)),
        ...visibleFormulas.map((formula) => getFormulaOutputKey(formula.id)),
    ];
    const valid = new Set(defaultOrder);
    const ordered = Array.from(
        new Set([
            ...(config.columnOrder || []).filter((key) => valid.has(key)),
            ...defaultOrder,
        ])
    );
    const aggregatedKeys = new Set([
        ...fields
            .filter((field) => isAggregatedField(field))
            .map((field) => getFieldOutputKey(field)),
        ...visibleFormulas
            .filter((formula) => !!formula.aggregation)
            .map((formula) => getFormulaOutputKey(formula.id)),
    ]);
    return ordered.find((key) => !aggregatedKeys.has(key)) ?? null;
}

function formatTotalNumber(value: number, locale: string): string {
    try {
        return new Intl.NumberFormat(locale).format(value);
    } catch {
        return String(value);
    }
}

/**
 * Totals per aggregated field over detail rows (before grouping), so AVG is
 * over source rows and money columns keep their row currencies.
 */
export function buildReportTotalsCells(
    detailRows: Record<string, unknown>[],
    config: GroupingReportConfig,
    options?: {
        locale?: string;
        accountCurrency?: string;
    }
): Record<string, ReportTotalsCell> {
    const locale = options?.locale || "en-US";
    const accountCurrency = options?.accountCurrency || "USD";
    const cells: Record<string, ReportTotalsCell> = {};

    for (const field of config.fields || []) {
        if (!isAggregatedField(field)) {
            continue;
        }
        const aggregation = String(field.aggregation).toUpperCase();
        const outputKey = getFieldOutputKey(field);
        const legacyKey = field.alias ? null : getLegacyFieldOutputKey(field);
        const isMoney =
            aggregation !== "COUNT" &&
            shouldFormatFieldAsCurrency(field.table, field.field);

        const values: number[] = [];
        const currencies = new Set<string>();
        for (const row of detailRows) {
            const value = extractAggregationSourceValue(
                row,
                outputKey,
                legacyKey
            );
            if (value === null) {
                continue;
            }
            values.push(value);
            if (isMoney) {
                currencies.add(
                    resolveCurrencyFromRow(row, accountCurrency, field.field)
                );
            }
        }

        if (isMoney && currencies.size > 1) {
            cells[outputKey] = { value: null, mixedCurrency: true };
            continue;
        }

        const value = calculateAggregation(values, aggregation);
        if (value === null) {
            cells[outputKey] = { value: null };
            continue;
        }
        if (isMoney) {
            const currency =
                Array.from(currencies)[0] || accountCurrency;
            cells[outputKey] = {
                value,
                currency,
                formatted: formatCurrencyValue(value, currency, locale),
            };
            continue;
        }
        cells[outputKey] = {
            value,
            formatted: formatTotalNumber(value, locale),
        };
    }

    const fields = config.fields || [];
    for (const formula of config.formulas || []) {
        if (!isAggregatedFormula(formula)) {
            continue;
        }
        const aggregation = String(formula.aggregation);
        const outputKey = getFormulaOutputKey(formula.id);
        const values: number[] = [];
        let sampleRow: Record<string, unknown> | undefined;
        for (const row of detailRows) {
            const value = coerceToNumber(row[outputKey]);
            if (value === null) {
                continue;
            }
            values.push(value);
            if (!sampleRow) {
                sampleRow = row;
            }
        }

        const value = calculateAggregation(values, aggregation);
        if (value === null) {
            cells[outputKey] = { value: null };
            continue;
        }
        const formatted = formatAggregatedFormulaValue(
            value,
            formula,
            sampleRow ?? {},
            fields,
            locale,
            accountCurrency
        );
        cells[outputKey] = formatted
            ? { value, formatted }
            : { value };
    }

    return cells;
}

export function buildCountAggregationTotals(
    rows: Record<string, unknown>[],
    fields: GroupingField[]
): Record<string, number> | undefined {
    const countTotals: Record<string, number> = {};
    for (const field of fields) {
        if (String(field.aggregation || "").toUpperCase() !== "COUNT") {
            continue;
        }
        const outputKey = getFieldOutputKey(field);
        countTotals[outputKey] = rows.reduce((sum, row) => {
            const n = coerceToNumber(row[outputKey]);
            return sum + (n ?? 0);
        }, 0);
    }
    return Object.keys(countTotals).length > 0 ? countTotals : undefined;
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
