import type { ImportType, Prisma } from "@prisma/client";

import {
    andODataFilters,
    compileEntityPullFilter,
    escapeODataStringLiteral,
} from "./billingConnectorPullFilterCompile";

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

function isCustnameField(field: string): boolean {
    return field.trim().toUpperCase() === "CUSTNAME";
}

/**
 * Customer $filter that is safe to AND onto Invoice / Payment / Contact.
 * Those entities share CUSTNAME; customer-only fields (CDES, …) would 400.
 */
export function resolveRelatedCustomerPullFilterOData(
    raw: unknown
): string | null {
    const map = parsePullFiltersMap(raw);
    const config = map.Customer;
    if (!config) {
        return null;
    }
    if (config.mode === "rules") {
        if (
            config.rules.length === 0 ||
            !config.rules.every((rule) => isCustnameField(rule.field))
        ) {
            return null;
        }
        return compileEntityPullFilter(config);
    }
    const withoutLiterals = config.odata.replace(/'([^']|'')*'/g, "''");
    const identifiers = withoutLiterals.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    const fields = identifiers.filter(
        (token) => !ODATA_KEYWORDS.has(token.toLowerCase())
    );
    if (fields.length === 0 || !fields.every(isCustnameField)) {
        return null;
    }
    return compileEntityPullFilter(config);
}

/**
 * OData $filter for a live import pull: the entity's own pull filter, plus a
 * CUSTNAME-only Customer filter on related entities so invoices/payments/
 * contacts stay inside the same customer subset.
 *
 * Optional Start-backfill `runtimeCustomerNumber` is AND-ed as `CUSTNAME eq …`
 * so customer-scoped pulls do not page the full table. Account extensions may
 * replace that clause via `buildRuntimeCustomerScopeOData` (account 10149 owns
 * IDG_CUSTNAME / IDC_CUSTNAMEIV on IDG_ARFNCITEMS*).
 */
export function resolveImportPullFilterOData(
    raw: unknown,
    importType: ImportType,
    options?: {
        runtimeCustomerNumber?: string | null;
        /** Extra values OR'd into the runtime customer-scope clause. */
        additionalCustomerNumbers?: string[] | null;
        entitySet?: string | null;
    }
): string | null {
    const entityFilter = resolveEntityPullFilterOData(raw, importType);
    const runtimeScope = resolveRuntimeCustomerScopeOData({
        customerNumber: options?.runtimeCustomerNumber,
        additionalCustomerNumbers: options?.additionalCustomerNumbers,
        entityType: importType,
        entitySet: options?.entitySet,
    });
    if (
        importType !== "Invoice" &&
        importType !== "Payment" &&
        importType !== "Contact"
    ) {
        return andODataFilters(entityFilter, runtimeScope);
    }
    return andODataFilters(
        resolveRelatedCustomerPullFilterOData(raw),
        entityFilter,
        runtimeScope
    );
}

/**
 * Generic ERP customer-number $filter for Start backfill customer scope.
 * Always uses `CUSTNAME`. Custom IDG_* customer fields belong in account
 * extensions (`buildRuntimeCustomerScopeOData`).
 *
 * When `additionalCustomerNumbers` is set (account extensions), builds
 * `(CUSTNAME eq 'A' or CUSTNAME eq 'B' or …)`.
 */
export function resolveRuntimeCustomerScopeOData(params: {
    customerNumber: string | null | undefined;
    additionalCustomerNumbers?: string[] | null;
    /** Kept for call-site compatibility; generic scope always uses CUSTNAME. */
    entityType: ImportType;
    entitySet?: string | null;
}): string | null {
    if (typeof params.customerNumber !== "string") {
        return null;
    }
    const trimmed = params.customerNumber.trim();
    if (!trimmed) {
        return null;
    }
    const values = new Set<string>([trimmed]);
    for (const extra of params.additionalCustomerNumbers ?? []) {
        if (typeof extra !== "string") {
            continue;
        }
        const value = extra.trim();
        if (value) {
            values.add(value);
        }
    }
    const clauses = [...values].map(
        (value) => `CUSTNAME eq ${escapeODataStringLiteral(value)}`
    );
    if (clauses.length === 1) {
        return clauses[0] ?? null;
    }
    return `(${clauses.join(" or ")})`;
}

/**
 * @deprecated Prefer {@link resolveRuntimeCustomerScopeOData}.
 */
export function compileRuntimeCustomerNumberOData(
    customerNumber: string | null | undefined,
    entityType: ImportType = "Invoice",
    entitySet?: string | null
): string | null {
    return resolveRuntimeCustomerScopeOData({
        customerNumber,
        entityType,
        entitySet,
    });
}
