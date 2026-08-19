"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriorityProviderClient = void 0;
const BillingProviderClient_1 = require("../billing/BillingProviderClient");
const priorityApiContract_1 = require("./priorityApiContract");
const connectorPaymentSynthetics_1 = require("../payment/connectorPaymentSynthetics");
const PriorityClient_1 = require("./PriorityClient");
function normalizeServiceRoot(baseUrl) {
    return baseUrl.replace(/\/+$/, "");
}
function buildAuthorizationHeader(authType, credentials) {
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
        const encoded = Buffer.from(`${String(username)}:${String(password)}`, "utf8").toString("base64");
        return `Basic ${encoded}`;
    }
    const accessToken = credentials.access_token;
    if (accessToken && typeof accessToken === "string") {
        return `Bearer ${accessToken}`;
    }
    throw new Error("OAuth2 access token is required");
}
function buildQueryString(params) {
    const search = new URLSearchParams(params);
    return search.toString();
}
class PriorityProviderClient {
    constructor(config) {
        this.config = config;
    }
    supportsFeature(feature) {
        switch (feature) {
            case BillingProviderClient_1.ConnectorFeature.TOTAL_COUNT:
            case BillingProviderClient_1.ConnectorFeature.DELETED_RECORDS:
            case BillingProviderClient_1.ConnectorFeature.DATE_WINDOW:
            case BillingProviderClient_1.ConnectorFeature.TOKEN_REFRESH:
                return false;
            default:
                return false;
        }
    }
    async testConnection() {
        const result = await (0, PriorityClient_1.testPriorityConnection)(this.config);
        if (!result.ok) {
            const error = new Error(result.error ?? "Connection failed");
            error.statusCode = result.statusCode;
            throw error;
        }
    }
    async discoverFields(entity) {
        if (!(0, priorityApiContract_1.isPriorityEntityImportType)(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }
        const discovered = await (0, PriorityClient_1.discoverPriorityFields)(this.config, entity, 5);
        if (!discovered.ok) {
            const error = new Error(discovered.error ?? "Failed to discover fields");
            error.statusCode = discovered.statusCode;
            throw error;
        }
        return discovered.rawHeaders.map((path) => ({
            path,
            example: discovered.exampleValues[path],
        }));
    }
    async pull(entity, options) {
        if (!(0, priorityApiContract_1.isPriorityEntityImportType)(entity)) {
            throw new Error(`Unsupported entity: ${entity}`);
        }
        const pageSize = options.pageSize ?? priorityApiContract_1.PRIORITY_RATE_LIMITS.recommendedPageSize;
        const skip = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
        const safeSkip = Number.isFinite(skip) && skip >= 0 ? skip : 0;
        const serviceRoot = normalizeServiceRoot(this.config.baseUrl);
        const collectionUrl = (0, priorityApiContract_1.buildEntityCollectionUrl)(serviceRoot, entity, options.entitySet);
        const params = { $top: String(pageSize) };
        if (entity === "Invoice" && priorityApiContract_1.PRIORITY_CREDIT_NOTE_HANDLING.subformSet) {
            params.$expand = priorityApiContract_1.PRIORITY_CREDIT_NOTE_HANDLING.subformSet;
        }
        if (safeSkip > 0) {
            params.$skip = String(safeSkip);
        }
        const endpoint = (0, priorityApiContract_1.getPriorityEntityEndpoint)(entity);
        const entitySetOverride = options.entitySet?.trim();
        const orderBy = entitySetOverride &&
            (entitySetOverride.includes("ARFNCITEMS") ||
                entitySetOverride.includes("FNCITEMS"))
            ? "FNCNUM"
            : endpoint.defaultOrderBy;
        params.$orderby = orderBy;
        if (options.filter && options.filter.trim()) {
            params.$filter = options.filter.trim();
        }
        if (options.since) {
            Object.assign(params, (0, priorityApiContract_1.buildIncrementalQueryParams)({
                watermarkIso: options.since.toISOString(),
                overlapMinutes: options.overlapMinutes ?? 0,
                preferSince: true,
            }));
        }
        const url = `${collectionUrl}?${buildQueryString(params)}`;
        const payload = await this.fetchJson(url);
        const value = payload.value;
        if (!Array.isArray(value)) {
            throw new Error("Unexpected Priority response shape (missing value array)");
        }
        const rawRecords = value.filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item));
        const records = entity === "Payment"
            ? (0, connectorPaymentSynthetics_1.applyPaymentSyntheticsToRecords)(rawRecords)
            : rawRecords;
        const hasMore = records.length === pageSize;
        const nextCursor = hasMore ? String(safeSkip + records.length) : null;
        return {
            records,
            nextCursor,
            hasMore,
        };
    }
    async fetchJson(url) {
        const authorization = buildAuthorizationHeader(this.config.authType, this.config.credentials);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), priorityApiContract_1.PRIORITY_RATE_LIMITS.requestTimeoutSeconds * 1000);
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
                const error = new Error(`Priority returned ${response.status}: ${detail}`);
                error.statusCode = response.status;
                throw error;
            }
            return response.json();
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.PriorityProviderClient = PriorityProviderClient;
