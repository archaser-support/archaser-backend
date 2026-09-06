import type { ConnectorAuthType, ImportType } from "@prisma/client";

import {
    ConnectorFeature,
    type BillingProviderClient,
    type PullOptions,
    type PullPage,
    type SourceField,
} from "../billing/BillingProviderClient";
import {
    PRIORITY_RATE_LIMITS,
    buildEntityCollectionUrl,
    getPriorityEntityEndpoint,
    isPriorityEntityImportType,
} from "./priorityApiContract";
import { applyPaymentSyntheticsToRecords } from "../payment/connectorPaymentSynthetics";
import { tracePaymentImportByRaw } from "../import/paymentImportTrace";
import {
    assertFilterFieldsExist,
    buildKeysetFilter,
    columnNameSet,
    DATE_FIELD_FALLBACKS,
    encodeKeysetCursor,
    formatOrderByClause,
    intersectSelectFields,
    KEYSET_TIE_BREAKER_FIELDS,
    odataFilterFieldNames,
    ORDER_BY_FALLBACKS,
    pickDateField,
    pickKeysetTieBreaker,
    pickOrderByField,
} from "./resolveTablePullShape";
import { PAYMENT_ALWAYS_SELECT_SOURCES } from "./prioritySelectFields";
import {
    discoverPriorityFields,
    fetchPriorityTableColumns,
    testPriorityConnection,
    type PriorityConnectionConfig,
} from "./PriorityClient";

function normalizeServiceRoot(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

function buildAuthorizationHeader(
    authType: ConnectorAuthType,
    credentials: Record<string, unknown>
): string {
    if (authType === "API_KEY") {
        const token = credentials.token;
        if (!token || typeof token !== "string") {
            throw new Error("API key token is required");
        }
        const encoded = Buffer.from(`${token}:PAT`, "utf8").toString("base64");
        return `Basic ${encoded}`;
    }

    if (authType === "BASIC") {
        const username = credentials.username;
        const password = credentials.password;
        if (!username || !password) {
            throw new Error("Username and password are required");
        }
        const encoded = Buffer.from(
            `${String(username)}:${String(password)}`,
            "utf8"
        ).toString("base64");
        return `Basic ${encoded}`;
    }

    const accessToken = credentials.access_token;
    if (accessToken && typeof accessToken === "string") {
        return `Bearer ${accessToken}`;
    }
    throw new Error("OAuth2 access token is required");
}

function buildQueryString(params: Record<string, string>): string {
    const search = new URLSearchParams(params);
    return search.toString();
}

function summarizePriorityHttpError(status: number, body: string): string {
    const trimmed = body.trim();
    if (!trimmed) {
        return `HTTP ${status}`;
    }
    if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
        return `HTTP ${status} HTML gateway error`;
    }
    return trimmed.slice(0, 200);
}

function andODataFilters(
    ...parts: Array<string | null | undefined>
): string | undefined {
    const cleaned = parts
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter((part) => part.length > 0);
    if (cleaned.length === 0) {
        return undefined;
    }
    if (cleaned.length === 1) {
        return cleaned[0];
    }
    return cleaned.map((part) => `(${part})`).join(" and ");
}

function recordFieldValue(
    record: Record<string, unknown>,
    field: string
): string | null {
    const raw = record[field];
    if (raw == null) {
        return null;
    }
    const text = String(raw).trim();
    return text.length > 0 ? text : null;
}

function recordKeysetCursor(
    record: Record<string, unknown>,
    orderBy: string,
    tieBreaker: string | null
): string | null {
    const primary = recordFieldValue(record, orderBy);
    if (primary == null) {
        return null;
    }
    if (!tieBreaker) {
        return primary;
    }
    const secondary = recordFieldValue(record, tieBreaker);
    return encodeKeysetCursor(primary, secondary);
}

function dateGeIso(date: Date, overlapMinutes: number): string {
    const ms = date.getTime() - overlapMinutes * 60 * 1000;
    return new Date(ms).toISOString();
}

function columnSampleCacheKey(
    entity: ImportType,
    entitySet?: string | null,
    filter?: string | null
): string {
    return `${entity}:${entitySet?.trim() ?? ""}:${filter?.trim() ?? ""}`;
}

function isIdgPaymentEntitySet(entitySet?: string | null): boolean {
    const name = (entitySet ?? "").trim().toUpperCase();
    return name.includes("IDG_ARFNCITEMS") || name.startsWith("IDG_");
}

export class PriorityProviderClient implements BillingProviderClient {
    private readonly config: PriorityConnectionConfig;
    private readonly tableColumnsByKey = new Map<string, string[]>();
    /** Successful $top sample under this filter returned 0 rows — pull is empty, not an error. */
    private readonly emptyFilterMatchKeys = new Set<string>();

    constructor(config: PriorityConnectionConfig) {
        this.config = config;
    }

    supportsFeature(feature: ConnectorFeature): boolean {
        switch (feature) {
            case ConnectorFeature.TOTAL_COUNT:
            case ConnectorFeature.DELETED_RECORDS:
            case ConnectorFeature.DATE_WINDOW:
            case ConnectorFeature.TOKEN_REFRESH:
                return false;
            default:
                return false;
        }
    }

    async testConnection(): Promise<void> {
        const result = await testPriorityConnection(this.config);
        if (!result.ok) {
            const error = new Error(result.error ?? "Connection failed") as Error & {
                statusCode?: number;
            };
            error.statusCode = result.statusCode;
            throw error;
        }
    }

    async discoverFields(entity: ImportType): Promise<SourceField[]> {
        if (!isPriorityEntityImportType(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }
        const discovered = await discoverPriorityFields(this.config, entity, 5);
        if (!discovered.ok) {
            const error = new Error(
                discovered.error ?? "Failed to discover fields"
            ) as Error & { statusCode?: number };
            error.statusCode = discovered.statusCode;
            throw error;
        }
        return discovered.rawHeaders.map((path) => ({
            path,
            example: discovered.exampleValues[path],
        }));
    }

    async pull(entity: ImportType, options: PullOptions): Promise<PullPage> {
        if (!isPriorityEntityImportType(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }

        const pageSize =
            options.pageSize ?? PRIORITY_RATE_LIMITS.recommendedPageSize;
        const skip = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
        const safeSkip = Number.isFinite(skip) && skip >= 0 ? skip : 0;

        const serviceRoot = normalizeServiceRoot(this.config.baseUrl);
        const collectionUrl = buildEntityCollectionUrl(
            serviceRoot,
            entity,
            options.entitySet
        );

        const columnCacheKey = columnSampleCacheKey(
            entity,
            options.entitySet,
            options.filter
        );
        const columnList = await this.columnsForTable(entity, options.entitySet, {
            filter: options.filter,
            select: options.select,
        });
        if (this.emptyFilterMatchKeys.has(columnCacheKey)) {
            return {
                records: [],
                nextCursor: null,
                hasMore: false,
            };
        }
        const columns = columnNameSet(columnList);
        const endpoint = getPriorityEntityEndpoint(entity);
        const preferredOrderBy = isIdgPaymentEntitySet(options.entitySet)
            ? "FNCNUM"
            : endpoint.defaultOrderBy;
        const orderBy = pickOrderByField(preferredOrderBy, columns);
        const tieBreaker = pickKeysetTieBreaker(columns, orderBy);
        const needsDate =
            options.createdOnOrAfter != null || options.since != null;
        const dateField = pickDateField(options.preferredDateField, columns);
        if (needsDate && !dateField) {
            throw new Error("No date column on this table");
        }

        const selectFields = intersectSelectFields(
            [
                orderBy,
                ...(tieBreaker ? [tieBreaker] : []),
                ...(dateField ? [dateField] : []),
                ...(options.select ?? []),
            ],
            columns,
            [
                orderBy,
                ...(tieBreaker ? [tieBreaker] : []),
                ...(dateField ? [dateField] : []),
            ]
        );

        const params: Record<string, string> = { $top: String(pageSize) };
        // Do not $expand CINVOICESCONT_SUBFORM on list pulls. Priority/idigital
        // returns HTTP 502 (HTML gateway page) after ~2 minutes on that query.
        // credit_for still maps from parent CREDITFOR / PIVNUM when present.
        const useKeyset =
            options.pagination === "keyset" || Boolean(options.afterKey?.trim());
        if (!useKeyset && safeSkip > 0) {
            params.$skip = String(safeSkip);
        }

        params.$orderby = formatOrderByClause(orderBy, tieBreaker);
        if (options.select != null && selectFields.length > 0) {
            params.$select = selectFields.join(",");
        }

        const afterKey = options.afterKey?.trim();
        const keysetFilter =
            useKeyset && afterKey
                ? buildKeysetFilter(orderBy, afterKey, tieBreaker)
                : null;
        const dateBound = options.createdOnOrAfter ?? options.since;
        const overlapMinutes =
            options.createdOnOrAfter == null && options.since
                ? (options.overlapMinutes ?? 0)
                : 0;
        const dateFilter =
            dateField && dateBound
                ? `${dateField} ge ${dateGeIso(dateBound, overlapMinutes)}`
                : null;
        assertFilterFieldsExist(options.filter, columns);
        const combinedFilter = andODataFilters(
            options.filter,
            dateFilter,
            keysetFilter
        );
        if (combinedFilter) {
            params.$filter = combinedFilter;
        }

        const url = `${collectionUrl}?${buildQueryString(params)}`;
        const payload = await this.fetchJson(url);
        const value = (payload as { value?: unknown[] }).value;

        if (!Array.isArray(value)) {
            throw new Error("Unexpected Priority response shape (missing value array)");
        }

        const rawRecords = value.filter(
            (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object" && !Array.isArray(item)
        );
        if (entity === "Payment") {
            for (const row of rawRecords) {
                tracePaymentImportByRaw("erp_pull_raw", row, {
                    pageSize,
                });
            }
        }
        const records =
            entity === "Payment"
                ? applyPaymentSyntheticsToRecords(rawRecords)
                : rawRecords;

        if (entity === "Payment") {
            for (const row of records) {
                tracePaymentImportByRaw("erp_pull_after_synthetics", row, {
                    pageSize,
                    recordCount: records.length,
                });
            }
        }

        const hasMore = records.length === pageSize;
        const lastKey = records.length
            ? recordKeysetCursor(
                  records[records.length - 1],
                  orderBy,
                  tieBreaker
              )
            : null;
        const nextCursor = useKeyset
            ? hasMore
                ? lastKey
                : null
            : hasMore
              ? String(safeSkip + records.length)
              : null;

        return {
            records,
            nextCursor,
            hasMore,
        };
    }

    private async columnsForTable(
        entity: ImportType,
        entitySet?: string | null,
        options?: {
            filter?: string | null;
            select?: string[] | null;
        }
    ): Promise<string[]> {
        if (!isPriorityEntityImportType(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }
        const filterKey = options?.filter?.trim() ?? "";
        const key = columnSampleCacheKey(entity, entitySet, filterKey);
        const cached = this.tableColumnsByKey.get(key);
        if (cached) {
            return cached;
        }
        this.config.onLog?.(
            `Sampling ${entity} columns (${entitySet?.trim() || "default table"})…`
        );
        const sampled = await fetchPriorityTableColumns(this.config, entity, {
            entitySet,
            filter: options?.filter,
        });
        if (!sampled.ok) {
            const filterPreview = (options?.filter ?? "").slice(0, 280);
            this.config.onLog?.(
                `[column-sample] entity=${entity} entitySet=${entitySet?.trim() || "default"} failed: ${sampled.error ?? "unknown"} filterLen=${(options?.filter ?? "").length} filterPreview=${filterPreview} — using fallback columns`
            );
            const fallback = this.fallbackColumnsForPull(entity, options, entitySet);
            this.emptyFilterMatchKeys.delete(key);
            this.tableColumnsByKey.set(key, fallback);
            return fallback;
        }
        if (sampled.columns.length === 0) {
            // Live sample succeeded with 0 rows under this filter — there is
            // nothing to pull. Do not invent columns (e.g. PAYNUM) that can 400
            // the real pull and abort the whole sync.
            const filterPreview = (options?.filter ?? "").slice(0, 280);
            this.config.onLog?.(
                `[column-sample] entity=${entity} entitySet=${entitySet?.trim() || "default"} source=empty_filter_match columnCount=0 filterLen=${(options?.filter ?? "").length} filterPreview=${filterPreview} — pull will return empty`
            );
            this.emptyFilterMatchKeys.add(key);
            this.tableColumnsByKey.set(key, []);
            return [];
        }
        this.emptyFilterMatchKeys.delete(key);
        this.tableColumnsByKey.set(key, sampled.columns);
        return sampled.columns;
    }

    /** Best-effort column names when Priority will not return a sample row quickly. */
    private fallbackColumnsForPull(
        entity: ImportType,
        options?: {
            filter?: string | null;
            select?: string[] | null;
        },
        entitySet?: string | null
    ): string[] {
        const names = new Set<string>();
        for (const name of odataFilterFieldNames(options?.filter)) {
            names.add(name);
        }
        for (const name of options?.select ?? []) {
            const trimmed = name.trim();
            if (trimmed) {
                names.add(trimmed);
            }
        }
        for (const name of ORDER_BY_FALLBACKS) {
            names.add(name);
        }
        for (const name of DATE_FIELD_FALLBACKS) {
            names.add(name);
        }
        for (const name of KEYSET_TIE_BREAKER_FIELDS) {
            names.add(name);
        }
        if (entity === "Payment") {
            for (const name of PAYMENT_ALWAYS_SELECT_SOURCES) {
                names.add(name);
            }
        }
        if (isPriorityEntityImportType(entity)) {
            const endpoint = getPriorityEntityEndpoint(entity);
            if (isIdgPaymentEntitySet(entitySet)) {
                // IDG_ARFNCITEMS* has FNCNUM/KLINE, not PAYNUM; no CREDIT/DEBIT.
                names.delete("PAYNUM");
                names.delete("CREDIT");
                names.delete("DEBIT");
                names.delete("PAYMENT");
                names.delete("CUSTNAME");
                names.add("FNCNUM");
                names.add("KLINE");
            } else if (endpoint.defaultOrderBy) {
                names.add(endpoint.defaultOrderBy);
            }
        }
        return Array.from(names);
    }

    private async fetchJson(url: string): Promise<unknown> {
        const authorization = buildAuthorizationHeader(
            this.config.authType,
            this.config.credentials
        );
        const timeoutSeconds = PRIORITY_RATE_LIMITS.requestTimeoutSeconds;
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            timeoutSeconds * 1000
        );

        let response: Response;
        try {
            response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: authorization,
                },
                signal: controller.signal,
            });
        } catch (err) {
            const elapsedMs = Date.now() - startedAt;
            if (controller.signal.aborted) {
                const message = `Priority request timed out after ${elapsedMs}ms (${timeoutSeconds}s limit)`;
                this.config.onLog?.(message);
                throw new Error(message);
            }
            const message = err instanceof Error ? err.message : String(err);
            this.config.onLog?.(
                `Priority request failed after ${elapsedMs}ms: ${message}`
            );
            throw err;
        } finally {
            clearTimeout(timeout);
        }

        const elapsedMs = Date.now() - startedAt;
        if (!response.ok) {
            const body = await response.text().catch(() => "");
            const summary = summarizePriorityHttpError(response.status, body);
            this.config.onLog?.(
                `Priority HTTP ${response.status} after ${elapsedMs}ms: ${summary}`
            );
            const error = new Error(
                `Priority returned ${response.status}: ${summary}`
            ) as Error & { statusCode?: number };
            error.statusCode = response.status;
            throw error;
        }

        return response.json();
    }
}
