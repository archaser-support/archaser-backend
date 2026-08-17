import type { ImportType, Prisma } from "@prisma/client";

import { compileEntityPullFilter } from "./billingConnectorPullFilterCompile";

export type PullFilterOperator =
    | "eq"
    | "ne"
    | "startswith"
    | "contains"
    | "gt"
    | "lt";

export const PULL_FILTER_OPERATORS: PullFilterOperator[] = [
    "eq",
    "ne",
    "startswith",
    "contains",
    "gt",
    "lt",
];

export interface PullFilterRule {
    field: string;
    operator: PullFilterOperator;
    value: string;
}

export interface AdvancedEntityPullFilter {
    mode: "advanced";
    odata: string;
}

export interface RulesEntityPullFilter {
    mode: "rules";
    rules: PullFilterRule[];
}

export type EntityPullFilterConfig =
    | AdvancedEntityPullFilter
    | RulesEntityPullFilter;

export type PullFiltersMap = Partial<
    Record<ImportType, EntityPullFilterConfig | null>
>;

const ENTITY_KEYS: ImportType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

const OPERATOR_SET = new Set<string>(PULL_FILTER_OPERATORS);

function isImportType(value: string): value is ImportType {
    return (ENTITY_KEYS as string[]).includes(value);
}

function isPullFilterOperator(value: string): value is PullFilterOperator {
    return OPERATOR_SET.has(value);
}

function isAdvancedConfig(value: unknown): value is AdvancedEntityPullFilter {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const row = value as Record<string, unknown>;
    return row.mode === "advanced" && typeof row.odata === "string";
}

function isRulesConfig(value: unknown): value is RulesEntityPullFilter {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const row = value as Record<string, unknown>;
    return row.mode === "rules" && Array.isArray(row.rules);
}

function normalizeRules(rules: unknown[]): PullFilterRule[] {
    const normalized: PullFilterRule[] = [];
    for (const rule of rules) {
        if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
            continue;
        }
        const row = rule as Record<string, unknown>;
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

function normalizeConfig(
    value: unknown
): EntityPullFilterConfig | null {
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

export function parsePullFiltersMap(raw: unknown): PullFiltersMap {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    const out: PullFiltersMap = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
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

export function mergePullFiltersPatch(
    existing: unknown,
    patch: PullFiltersMap | undefined
): PullFiltersMap {
    const base = parsePullFiltersMap(existing);
    if (!patch) {
        return base;
    }
    const next: PullFiltersMap = { ...base };
    for (const key of ENTITY_KEYS) {
        if (!(key in patch)) {
            continue;
        }
        const normalized = normalizeConfig(patch[key]);
        if (normalized) {
            next[key] = normalized;
        } else {
            delete next[key];
        }
    }
    return next;
}

export function pullFiltersToPrismaJson(
    map: PullFiltersMap
): Prisma.InputJsonValue {
    return map as Prisma.InputJsonValue;
}

export function listChangedPullFilterEntities(params: {
    existing: unknown;
    next: PullFiltersMap;
}): ImportType[] {
    const prev = parsePullFiltersMap(params.existing);
    const changed: ImportType[] = [];
    for (const key of ENTITY_KEYS) {
        const before = JSON.stringify(prev[key] ?? null);
        const after = JSON.stringify(params.next[key] ?? null);
        if (before !== after) {
            changed.push(key);
        }
    }
    return changed;
}

export function toPublicPullFilters(raw: unknown): {
    pull_filters: PullFiltersMap;
    effective_pull_filters: Partial<Record<ImportType, string | null>>;
} {
    const pull_filters = parsePullFiltersMap(raw);
    const effective_pull_filters: Partial<Record<ImportType, string | null>> =
        {};
    for (const key of ENTITY_KEYS) {
        effective_pull_filters[key] = compileEntityPullFilter(
            pull_filters[key]
        );
    }
    return { pull_filters, effective_pull_filters };
}

export function resolveEntityPullFilterOData(
    raw: unknown,
    importType: ImportType
): string | null {
    const map = parsePullFiltersMap(raw);
    return compileEntityPullFilter(map[importType]);
}
