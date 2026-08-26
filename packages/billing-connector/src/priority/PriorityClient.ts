import type { ConnectorAuthType } from "@prisma/client";

import {
    PRIORITY_RATE_LIMITS,
    buildEntityCollectionUrl,
    type PriorityApiKeyCredentials,
    type PriorityBasicCredentials,
    type PriorityOAuth2Credentials,
} from "./priorityApiContract";
import type { PriorityEntityImportType } from "./samplePayloads";
import { discoverFieldPathsFromRecords } from "../utils/connectorFieldUtils";
import { applyPaymentSyntheticsToRecords } from "../payment/connectorPaymentSynthetics";
import { columnNamesFromRecords } from "./resolveTablePullShape";

export interface PriorityConnectionConfig {
    baseUrl: string;
    authType: ConnectorAuthType;
    credentials: Record<string, unknown>;
    onLog?: (message: string) => void;
}

export interface PriorityTestConnectionResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    testedAt: Date;
}

export interface PriorityFetchResult {
    ok: boolean;
    statusCode?: number;
    error?: string;
    records: Record<string, unknown>[];
}

function buildAuthorizationHeader(
    authType: ConnectorAuthType,
    credentials: Record<string, unknown>
): string {
    if (authType === "API_KEY") {
        const { token } = credentials as unknown as PriorityApiKeyCredentials;
        if (!token || typeof token !== "string") {
            throw new Error("API key token is required");
        }
        const encoded = Buffer.from(`${token}:PAT`, "utf8").toString("base64");
        return `Basic ${encoded}`;
    }

    if (authType === "BASIC") {
        const { username, password } =
            credentials as unknown as PriorityBasicCredentials;
        if (!username || !password) {
            throw new Error("Username and password are required");
        }
        const encoded = Buffer.from(`${username}:${password}`, "utf8").toString(
            "base64"
        );
        return `Basic ${encoded}`;
    }

    const oauth = credentials as unknown as PriorityOAuth2Credentials;
    if (oauth.access_token && typeof oauth.access_token === "string") {
        return `Bearer ${oauth.access_token}`;
    }
    throw new Error(
        "OAuth2 access token is required for connection test (refresh not implemented in this phase)"
    );
}

function normalizeServiceRoot(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

/**
 * Lightweight connectivity check — fetches one customer row from OData.
 * Works against Priority sandbox or the local mock server.
 */
export async function testPriorityConnection(
    config: PriorityConnectionConfig
): Promise<PriorityTestConnectionResult> {
    const testedAt = new Date();

    if (!config.baseUrl?.trim()) {
        return { ok: false, error: "Base URL is required", testedAt };
    }

    try {
        const authorization = buildAuthorizationHeader(
            config.authType,
            config.credentials
        );
        const serviceRoot = normalizeServiceRoot(config.baseUrl);
        const url = `${serviceRoot}/CUSTOMERS?$top=1`;
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            PRIORITY_RATE_LIMITS.requestTimeoutSeconds * 1000
        );

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: authorization,
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                const detail = body ? body.slice(0, 200) : response.statusText;
                return {
                    ok: false,
                    statusCode: response.status,
                    error: `Priority returned ${response.status}: ${detail}`,
                    testedAt,
                };
            }

            const payload = (await response.json()) as { value?: unknown[] };
            if (!Array.isArray(payload?.value)) {
                return {
                    ok: false,
                    statusCode: response.status,
                    error: "Unexpected Priority response shape (missing value array)",
                    testedAt,
                };
            }

            return { ok: true, statusCode: response.status, testedAt };
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Connection failed";
        return { ok: false, error: message, testedAt };
    }
}

async function fetchPriorityJson(
    config: PriorityConnectionConfig,
    url: string
): Promise<{ ok: boolean; statusCode?: number; error?: string; payload?: unknown }> {
    if (!config.baseUrl?.trim()) {
        return { ok: false, error: "Base URL is required" };
    }

    try {
        const authorization = buildAuthorizationHeader(
            config.authType,
            config.credentials
        );
        const controller = new AbortController();
        const timeout = setTimeout(
            () => controller.abort(),
            PRIORITY_RATE_LIMITS.requestTimeoutSeconds * 1000
        );

        try {
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    Accept: "application/json",
                    Authorization: authorization,
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                const detail = body ? body.slice(0, 200) : response.statusText;
                return {
                    ok: false,
                    statusCode: response.status,
                    error: `Priority returned ${response.status}: ${detail}`,
                };
            }

            const payload = await response.json();
            return { ok: true, statusCode: response.status, payload };
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Priority request failed";
        return { ok: false, error: message };
    }
}

export async function fetchPriorityEntitySamples(
    config: PriorityConnectionConfig,
    importType: PriorityEntityImportType,
    top = 10,
    options?: { entitySet?: string | null; filter?: string | null }
): Promise<PriorityFetchResult> {
    const serviceRoot = normalizeServiceRoot(config.baseUrl);
    const collectionUrl = buildEntityCollectionUrl(
        serviceRoot,
        importType,
        options?.entitySet
    );
    const params = new URLSearchParams({ $top: String(top) });
    if (options?.filter?.trim()) {
        params.set("$filter", options.filter.trim());
    }
    const url = `${collectionUrl}?${params.toString()}`;
    const result = await fetchPriorityJson(config, url);

    if (!result.ok) {
        return {
            ok: false,
            statusCode: result.statusCode,
            error: result.error,
            records: [],
        };
    }

    const payload = result.payload as { value?: unknown[] };
    if (!Array.isArray(payload?.value)) {
        return {
            ok: false,
            statusCode: result.statusCode,
            error: "Unexpected Priority response shape (missing value array)",
            records: [],
        };
    }

    const rawRecords = payload.value.filter(
        (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
    const records =
        importType === "Payment"
            ? applyPaymentSyntheticsToRecords(rawRecords)
            : rawRecords;

    return { ok: true, statusCode: result.statusCode, records };
}

export async function fetchPriorityTableColumns(
    config: PriorityConnectionConfig,
    importType: PriorityEntityImportType,
    options?: { entitySet?: string | null }
): Promise<
    | { ok: true; columns: string[] }
    | { ok: false; error: string; statusCode?: number }
> {
    const serviceRoot = normalizeServiceRoot(config.baseUrl);
    const collectionUrl = buildEntityCollectionUrl(
        serviceRoot,
        importType,
        options?.entitySet
    );
    const url = `${collectionUrl}?${new URLSearchParams({ $top: "5" }).toString()}`;
    const result = await fetchPriorityJson(config, url);
    if (!result.ok) {
        return {
            ok: false,
            statusCode: result.statusCode,
            error: result.error ?? "Failed to sample Priority table",
        };
    }
    const payload = result.payload as { value?: unknown[] };
    if (!Array.isArray(payload?.value)) {
        return {
            ok: false,
            statusCode: result.statusCode,
            error: "Unexpected Priority response shape (missing value array)",
        };
    }
    const records = payload.value.filter(
        (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
    return { ok: true, columns: columnNamesFromRecords(records) };
}

export async function discoverPriorityFields(
    config: PriorityConnectionConfig,
    importType: PriorityEntityImportType,
    top = 5,
    options?: { entitySet?: string | null }
): Promise<
    | {
          ok: true;
          rawHeaders: string[];
          exampleValues: Record<string, unknown>;
          sampleCount: number;
      }
    | { ok: false; error: string; statusCode?: number }
> {
    const fetchResult = await fetchPriorityEntitySamples(
        config,
        importType,
        top,
        options
    );
    if (!fetchResult.ok) {
        return {
            ok: false,
            error: fetchResult.error ?? "Failed to discover fields",
            statusCode: fetchResult.statusCode,
        };
    }

    const discovered = discoverFieldPathsFromRecords(fetchResult.records);
    return {
        ok: true,
        rawHeaders: discovered.rawHeaders,
        exampleValues: discovered.exampleValues,
        sampleCount: fetchResult.records.length,
    };
}

/**
 * Parse EntitySet names from Priority OData $metadata (XML).
 */
export async function fetchPriorityEntitySetCatalog(
    config: PriorityConnectionConfig
): Promise<
    | { ok: true; names: string[]; statusCode?: number }
    | { ok: false; error: string; statusCode?: number }
> {
    const serviceRoot = normalizeServiceRoot(config.baseUrl);
    const url = `${serviceRoot}/$metadata`;
    try {
        const authorization = buildAuthorizationHeader(
            config.authType,
            config.credentials
        );
        const response = await fetch(url, {
            method: "GET",
            headers: {
                Accept: "application/xml",
                Authorization: authorization,
            },
        });
        const text = await response.text();
        if (!response.ok) {
            return {
                ok: false,
                statusCode: response.status,
                error: text.slice(0, 400) || `HTTP ${response.status}`,
            };
        }
        const names = Array.from(
            new Set(
                Array.from(text.matchAll(/EntitySet Name="([^"]+)"/g)).map(
                    (match) => match[1]
                )
            )
        )
            .filter((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
            .sort((a, b) => a.localeCompare(b));

        return { ok: true, statusCode: response.status, names };
    } catch (error) {
        return {
            ok: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to fetch Priority metadata",
        };
    }
}
