import { ReportFilterDto } from "./dto/execute-report.dto";
import {
    getFormulaOutputKey,
    isFormulaFilterField,
    type ReportFormula,
} from "./report-formula/types";

export const FORMULA_FILTER_GROUPING_CONFLICT_CODE =
    "FORMULA_FILTER_GROUPING_CONFLICT" as const;
export const ORPHAN_FORMULA_FILTER_CODE = "ORPHAN_FORMULA_FILTER" as const;

export type FormulaFilterGuardErrorCode =
    | typeof FORMULA_FILTER_GROUPING_CONFLICT_CODE
    | typeof ORPHAN_FORMULA_FILTER_CODE;

export type FormulaFilterGuardFailure = {
    errorCode: FormulaFilterGuardErrorCode;
    message: string;
};

const FORMULA_FILTER_GROUPING_CONFLICT_MESSAGE =
    "Formula filters cannot be used with grouping. Remove the formula filter(s) or the grouping.";

const ORPHAN_FORMULA_FILTER_MESSAGE =
    "A filter references a formula that is not on this report. Remove or update the filter.";

/**
 * Split report filters into Prisma-backed vs post-formula in-memory filters.
 * Formula identity is the field key (`formula:<id>`), regardless of table.
 */
export function partitionFiltersByFormulaTarget(filters: ReportFilterDto[]): {
    databaseFilters: ReportFilterDto[];
    formulaFilters: ReportFilterDto[];
} {
    const databaseFilters: ReportFilterDto[] = [];
    const formulaFilters: ReportFilterDto[] = [];
    for (const filter of filters) {
        if (isFormulaFilterField(filter?.field)) {
            formulaFilters.push(filter);
        } else {
            databaseFilters.push(filter);
        }
    }
    return { databaseFilters, formulaFilters };
}

function isGroupedReportConfig(config: {
    grouping?: string[] | null;
    fields?: Array<{ aggregation?: string | null }> | null;
}): boolean {
    const hasGrouping = (config.grouping?.length ?? 0) > 0;
    const hasAggregatedField = (config.fields || []).some(
        (field) => !!field.aggregation
    );
    return hasGrouping || hasAggregatedField;
}

/**
 * Hard guards for formula filters: orphan formula ids and grouping conflict.
 * Returns the first failure, or null when filters are allowed.
 * Orphan checks run before grouping so a deleted formula is never silent.
 */
export function findFormulaFilterGuardFailure(params: {
    filters: Array<{ field?: string | null }> | null | undefined;
    formulas?: Array<Pick<ReportFormula, "id">> | null;
    grouping?: string[] | null;
    fields?: Array<{ aggregation?: string | null }> | null;
}): FormulaFilterGuardFailure | null {
    const filters = Array.isArray(params.filters) ? params.filters : [];
    const formulaFilters = filters.filter((filter) =>
        isFormulaFilterField(filter?.field)
    );
    if (formulaFilters.length === 0) {
        return null;
    }

    const knownKeys = new Set(
        (params.formulas || []).map((formula) =>
            getFormulaOutputKey(formula.id)
        )
    );
    const hasOrphan = formulaFilters.some(
        (filter) => !knownKeys.has(filter.field as string)
    );
    if (hasOrphan) {
        return {
            errorCode: ORPHAN_FORMULA_FILTER_CODE,
            message: ORPHAN_FORMULA_FILTER_MESSAGE,
        };
    }

    if (
        isGroupedReportConfig({
            grouping: params.grouping,
            fields: params.fields,
        })
    ) {
        return {
            errorCode: FORMULA_FILTER_GROUPING_CONFLICT_CODE,
            message: FORMULA_FILTER_GROUPING_CONFLICT_MESSAGE,
        };
    }

    return null;
}

function isBlankFormulaRaw(raw: unknown): boolean {
    return raw === null || raw === undefined || raw === "";
}

function coerceFilterCompareNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "boolean") {
        return value ? 1 : 0;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed === "") {
            return null;
        }
        const asNumber = Number(trimmed);
        if (Number.isFinite(asNumber)) {
            return asNumber;
        }
    }
    return null;
}

/**
 * Compare raw formula value to filter value numerically.
 * Blank/null formula results never match (only is_empty / is_not_empty).
 */
function matchNumericFormulaCompare(
    raw: unknown,
    filterValue: unknown,
    compare: (actual: number, expected: number) => boolean
): boolean {
    if (isBlankFormulaRaw(raw)) {
        return false;
    }
    const expected = coerceFilterCompareNumber(filterValue);
    const actual = coerceFilterCompareNumber(raw);
    if (expected === null || actual === null) {
        return false;
    }
    return compare(actual, expected);
}

/**
 * Match a single formula filter against a row's raw formula value
 * (`row[formula:<id>]`). Blank/null never matches equals / not_equals /
 * greater / less comparisons — only is_empty / is_not_empty.
 */
export function rowMatchesFormulaFilter(
    row: Record<string, unknown>,
    filter: ReportFilterDto
): boolean {
    const field = filter.field;
    if (!isFormulaFilterField(field)) {
        return true;
    }
    const raw = row[field];
    const op = (filter.operator || "equals").toLowerCase();

    switch (op) {
        case "is_empty":
            return isBlankFormulaRaw(raw);
        case "is_not_empty":
            return !isBlankFormulaRaw(raw);
        case "=":
        case "equals":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual === expected
            );
        case "!=":
        case "not_equals":
        case "not":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual !== expected
            );
        case ">":
        case "greater_than":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual > expected
            );
        case ">=":
        case "greater_or_equal":
        case "greater_than_or_equal":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual >= expected
            );
        case "<":
        case "less_than":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual < expected
            );
        case "<=":
        case "less_or_equal":
        case "less_than_or_equal":
            return matchNumericFormulaCompare(
                raw,
                filter.value,
                (actual, expected) => actual <= expected
            );
        default:
            // Unknown operators do not match.
            return false;
    }
}

/** Keep rows that satisfy every formula filter (AND). */
export function applyFormulaFiltersToRows<T extends Record<string, unknown>>(
    rows: T[],
    formulaFilters: ReportFilterDto[]
): T[] {
    if (!formulaFilters.length) {
        return rows;
    }
    return rows.filter((row) =>
        formulaFilters.every((filter) => rowMatchesFormulaFilter(row, filter))
    );
}
