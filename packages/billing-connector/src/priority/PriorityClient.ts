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

export interface PriorityConnectionConfig {
    baseUrl: string;
    authType: ConnectorAuthType;
    credentials: Record<string, unknown>;
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
    top = 10
): Promise<PriorityFetchResult> {
    const serviceRoot = normalizeServiceRoot(config.baseUrl);
    const collectionUrl = buildEntityCollectionUrl(serviceRoot, importType);
    const url = `${collectionUrl}?$top=${top}`;
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

    const records = payload.value.filter(
        (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );

    return { ok: true, statusCode: result.statusCode, records };
}

export async function discoverPriorityFields(
    config: PriorityConnectionConfig,
    importType: PriorityEntityImportType,
    top = 5
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
        top
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
