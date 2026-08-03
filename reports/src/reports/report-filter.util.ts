import { ReportFilterDto } from "./dto/execute-report.dto";
import {
    isComputedReportField,
    isPrismaScalarField,
} from "./report-virtual-fields.util";
import {
    DatePresetMarker,
    isDatePresetMarker,
    isPeriodPreset,
    resolveDatePreset,
    resolveDatePresetRange,
} from "./date-preset.util";

type PrismaWhere = Record<string, unknown>;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerceValue(value: unknown): unknown {
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

/**
 * Prisma DateTime filters reject bare YYYY-MM-DD ("premature end of input").
 * Match leaves ReportExecutionService.helpers: start-of-day / end-of-day UTC.
 */
export function coerceDateTimeBound(
    value: unknown,
    bound: "start" | "end"
): unknown {
    if (typeof value === "string" && YMD_RE.test(value)) {
        return new Date(
            value + (bound === "end" ? "T23:59:59.999Z" : "T00:00:00.000Z")
        );
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

function isYmdString(value: unknown): value is string {
    return typeof value === "string" && YMD_RE.test(value);
}

/**
 * Resolve a relative date preset marker (e.g. `{ __datePreset: "today" }`) into
 * a Prisma scalar filter. Point presets resolve to a single date and reuse the
 * normal operator handling; period presets resolve to a [start, end] range and
 * map comparison operators onto the appropriate bound.
 */
function datePresetToPrisma(
    op: string,
    marker: DatePresetMarker
): PrismaWhere | null {
    const preset = marker.__datePreset;
    const input = marker.__datePresetInput;

    if (isPeriodPreset(preset)) {
        const range = resolveDatePresetRange(preset, input);
        if (!range) {
            return null;
        }
        const [start, end] = range;
        const startBound = coerceDateTimeBound(start, "start");
        const endBound = coerceDateTimeBound(end, "end");
        switch (op) {
            case "<":
            case "less_than":
                return { lt: startBound };
            case "<=":
            case "less_than_or_equal":
                return { lte: endBound };
            case ">":
            case "greater_than":
                return { gt: endBound };
            case ">=":
            case "greater_than_or_equal":
                return { gte: startBound };
            case "!=":
            case "not_equals":
            case "not":
                return { not: { gte: startBound, lte: endBound } };
            case "=":
            case "equals":
            case "between":
            default:
                return { gte: startBound, lte: endBound };
        }
    }

    const resolved = resolveDatePreset(preset, input);
    if (!resolved) {
        return null;
    }
    // Reuse the normal date-string handling (full-day range for equals, etc.).
    return operatorToPrisma(op, resolved);
}

/** Map a report filter operator to a Prisma scalar filter object. */
export function operatorToPrisma(
    operator: string,
    value: unknown
): PrismaWhere | null {
    const op = (operator || "equals").toLowerCase();
    if (isDatePresetMarker(value)) {
        return datePresetToPrisma(op, value);
    }
    const v = coerceValue(value);

    switch (op) {
        case "=":
        case "equals":
            // Date-only string on Timestamptz → full-day range (leaves parity).
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
        // FilterBuilder's empty operators carry no user value, so the incoming
        // `value` is a placeholder and must never reach Prisma — a DateTime or
        // Int column rejects it and the whole report execution throws.
        case "is_empty":
            return { equals: null };
        case "is_not_null":
        case "isnotnull":
        case "is_not_empty":
            return { not: null };
        case "between": {
            if (Array.isArray(v) && v.length >= 2) {
                const start = coerceDateTimeBound(v[0], "start");
                const end = coerceDateTimeBound(v[1], "end");
                if (
                    start === "" ||
                    start == null ||
                    end === "" ||
                    end == null
                ) {
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

export type SplitFiltersOptions = {
    /** Fields to omit from Prisma where (e.g. expanded __dashboard_* markers). */
    skipFields?: Set<string>;
};

/**
 * Build Prisma where clauses for filters that target `primaryTable`.
 * Nested-table filters are returned separately for relation where.
 */
export function splitFiltersByTable(
    filters: ReportFilterDto[],
    primaryTable: string,
    options: SplitFiltersOptions = {}
): {
    primary: PrismaWhere;
    nested: Record<string, PrismaWhere>;
} {
    const primary: PrismaWhere = {};
    const nested: Record<string, PrismaWhere> = {};
    const skip = options.skipFields;

    for (const f of filters) {
        if (!f?.table || !f?.field) {
            continue;
        }
        if (skip?.has(f.field)) {
            continue;
        }
        // Never send client marker fields to Prisma.
        if (f.field.startsWith("__")) {
            continue;
        }
        const clause = operatorToPrisma(f.operator, f.value);
        if (!clause) {
            continue;
        }
        if (f.table === primaryTable) {
            // Virtual / non-column fields must not reach Prisma where.
            if (
                isComputedReportField(primaryTable, f.field) ||
                (!f.field.includes(".") &&
                    !isPrismaScalarField(primaryTable, f.field))
            ) {
                continue;
            }
            primary[f.field] = clause;
        } else {
            if (
                isComputedReportField(f.table, f.field) ||
                (!f.field.includes(".") &&
                    !isPrismaScalarField(f.table, f.field))
            ) {
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

export function mergeAndWhere(
    ...parts: Array<PrismaWhere | undefined | null>
): PrismaWhere {
    const and: PrismaWhere[] = [];
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
