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
import {
    assertFilterFieldsExist,
    buildKeysetFilter,
    columnNameSet,
    encodeKeysetCursor,
    formatOrderByClause,
    intersectSelectFields,
    pickDateField,
    pickKeysetTieBreaker,
    pickOrderByField,
} from "./resolveTablePullShape";
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

export class PriorityProviderClient implements BillingProviderClient {
    private readonly config: PriorityConnectionConfig;
    private readonly tableColumnsByKey = new Map<string, string[]>();

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

        const columns = columnNameSet(
            await this.columnsForTable(entity, options.entitySet)
        );
        const endpoint = getPriorityEntityEndpoint(entity);
        const orderBy = pickOrderByField(endpoint.defaultOrderBy, columns);
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
        const records =
            entity === "Payment"
                ? applyPaymentSyntheticsToRecords(rawRecords)
                : rawRecords;

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
        entitySet?: string | null
    ): Promise<string[]> {
        if (!isPriorityEntityImportType(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }
        const key = `${entity}:${entitySet?.trim() ?? ""}`;
        const cached = this.tableColumnsByKey.get(key);
        if (cached) {
            return cached;
        }
        this.config.onLog?.(
            `Sampling ${entity} columns (${entitySet?.trim() || "default table"})…`
        );
        const sampled = await fetchPriorityTableColumns(this.config, entity, {
            entitySet,
        });
        if (!sampled.ok) {
            throw new Error(
                sampled.error ?? "Failed to sample Priority table columns"
            );
        }
        if (sampled.columns.length === 0) {
            throw new Error(
                "This table returned no columns; cannot build a safe request"
            );
        }
        this.tableColumnsByKey.set(key, sampled.columns);
        return sampled.columns;
    }

    private async fetchJson(url: string): Promise<unknown> {
        const authorization = buildAuthorizationHeader(
            this.config.authType,
            this.config.credentials
        );
        const timeoutSeconds = PRIORITY_RATE_LIMITS.requestTimeoutSeconds;
        const startedAt = Date.now();
        this.config.onLog?.(
            `Priority GET ${url} (timeout ${timeoutSeconds}s)`
        );
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

        const payload = await response.json();
        this.config.onLog?.(
            `Priority HTTP ${response.status} after ${elapsedMs}ms`
        );
        return payload;
    }
}
