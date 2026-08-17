/**
 * Priority ERP OData API contract — Phase 0 discovery output.
 *
 * Sources:
 * - https://prioritysoftware.github.io/restapi/
 * - .cursor/plans/erp_billing_connector_22321e7a.plan.md (Phase 0)
 *
 * Pilot validation: confirm entity set names and field names via
 * `GET {baseUrl}/$metadata` and `GET {baseUrl}/GetMetadataFor(entity='ENTITY')`
 * against the target Priority environment before Phase 4b ships.
 */
import type { ImportType } from "@prisma/client";
import { CONTACT_SAMPLES, CUSTOMER_SAMPLES, INVOICE_SAMPLES, PAYMENT_SAMPLES, SAMPLE_PAYLOADS_BY_IMPORT_TYPE, type PriorityEntityImportType } from "./samplePayloads";
export { CONTACT_SAMPLES, CUSTOMER_SAMPLES, INVOICE_SAMPLES, PAYMENT_SAMPLES, SAMPLE_PAYLOADS_BY_IMPORT_TYPE, type PriorityEntityImportType, };
/** Connector auth modes supported by Archaser (see BillingConnector.credentials_encrypted). */
export type PriorityConnectorAuthType = "API_KEY" | "OAUTH2_CLIENT_CREDENTIALS" | "BASIC";
/**
 * Recommended auth for Priority OData integrations.
 *
 * Priority documents three production patterns:
 * 1. **PAT Basic auth (recommended default)** — username = REST access token,
 *    password = literal `PAT`. Maps to `API_KEY` in Archaser (token stored once).
 * 2. **Legacy Basic** — username = API User Name, password = Priority password.
 *    Maps to `BASIC`.
 * 3. **OAuth2 Authorization Code + PKCE** — when External ID module is enabled.
 *    Maps to `OAUTH2_CLIENT_CREDENTIALS` with token_endpoint refresh.
 */
export declare const PRIORITY_RECOMMENDED_AUTH_TYPE: PriorityConnectorAuthType;
export interface PriorityApiKeyCredentials {
    /** REST Interface Access Token (sent as Basic auth username). */
    token: string;
}
export interface PriorityOAuth2Credentials {
    client_id: string;
    client_secret: string;
    /** e.g. https://{priority_domain}/accounts/connect/token */
    token_endpoint: string;
    access_token?: string;
    access_token_expires_at?: string;
    refresh_token?: string;
}
export interface PriorityBasicCredentials {
    /** API User Name from Personnel File. */
    username: string;
    password: string;
}
export type PriorityCredentialsEncrypted = PriorityApiKeyCredentials | PriorityOAuth2Credentials | PriorityBasicCredentials;
/** How Archaser sends auth on each OData request. */
export interface PriorityAuthContract {
    authType: PriorityConnectorAuthType;
    /** `Authorization: Basic base64(credentials)` for API_KEY and BASIC. */
    headerName: "Authorization";
    /** Bearer token for OAuth2 after token exchange. */
    oauth2HeaderName: "Authorization";
    oauth2HeaderPrefix: "Bearer";
    /**
     * Optional per-application license headers (Priority v18.3+).
     * Omit when using generic API licensing.
     */
    optionalAppLicenseHeaders: readonly ["X-App-Id", "X-App-Key"];
    credentialsShape: Record<PriorityConnectorAuthType, readonly string[]>;
}
export declare const PRIORITY_AUTH_CONTRACT: PriorityAuthContract;
/**
 * OData service root pattern:
 * `{scheme}://{host}/odata/Priority/{tabula.ini}/{company_env}`
 *
 * Sandbox (Priority 25.0, AWS):
 * https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo
 */
export declare const PRIORITY_SANDBOX_SERVICE_ROOT = "https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo";
export declare const PRIORITY_SANDBOX_CREDENTIALS: PriorityBasicCredentials;
export interface PriorityTransportContract {
    protocol: "OData v4 over HTTPS";
    defaultAccept: "application/json";
    dateFormat: "DateTimeOffset (YYYY-MM-DDTHH:MM:SS+HH:MM or Z)";
    maxPageSizeConstant: "MAXAPILINES (default 2000, v25.1+)";
    /** OData collection responses wrap records in `{ value: [...] }`. */
    collectionWrapperKey: "value";
    /** No standard X-Total-Count; use page iteration until empty page. */
    totalCountHeader: null;
    totalCountStrategy: "iterate_until_short_page";
}
export declare const PRIORITY_TRANSPORT: PriorityTransportContract;
export interface PriorityRateLimitContract {
    callsPerMinutePerUser: 100;
    maxParallelRequests: 10;
    maxQueuedRequests: 5;
    requestTimeoutSeconds: 180;
    throttleStatusCode: 429;
    /** Priority Cloud does not document a standard Retry-After header. */
    retryAfterHeader: "Retry-After (not guaranteed)";
    recommendedBackoffSeconds: readonly [5, 15, 30];
    recommendedPageSize: 500;
}
export declare const PRIORITY_RATE_LIMITS: PriorityRateLimitContract;
export type PriorityPaginationStyle = "odata_top_skip";
export interface PriorityPaginationContract {
    style: PriorityPaginationStyle;
    topParam: "$top";
    skipParam: "$skip";
    defaultMaxRecords: 2000;
    recommendedTop: 500;
    /** Continue while `value.length === $top`; stop on shorter page. */
    terminationRule: "short_page";
}
export declare const PRIORITY_PAGINATION: PriorityPaginationContract;
export type PriorityIncrementalFilterKind = "since" | "filter_udate";
export interface PriorityIncrementalFilterContract {
    /**
     * Preferred: `$since=ISO8601Z` (Priority 20.0+, BPM-enabled entities only).
     * Fallback: `$filter=UDATE ge {watermark_minus_overlap}`.
     */
    primary: PriorityIncrementalFilterKind;
    fallback: PriorityIncrementalFilterKind;
    sinceParam: "$since";
    sinceFormat: "UTC with Z suffix (e.g. 2025-06-01T07:25:00Z)";
    udateField: "UDATE";
    /** Archaser applies overlap on the watermark before building the filter. */
    overlapMinutesDefault: 5;
    overlapDuringBackfill: 0;
}
export declare const PRIORITY_INCREMENTAL_FILTER: PriorityIncrementalFilterContract;
export interface PriorityEntityEndpointContract {
    importType: PriorityEntityImportType;
    /** Priority form / OData entity set name. Confirm in Limited Access/API Forms. */
    entitySet: string;
    /** Relative path appended to service root (no leading slash). */
    path: string;
    erpPrimaryKeyFields: readonly string[];
    /** Archaser natural key / DB column fed by the ERP PK mapping. */
    archaserIdField: string;
    incrementalFilter: PriorityIncrementalFilterContract;
    pagination: PriorityPaginationContract;
    /** Representative OData fields for default field-discovery UI. */
    discoveryFields: readonly string[];
    notes?: string;
}
export declare const PRIORITY_ENTITY_ENDPOINTS: Record<PriorityEntityImportType, PriorityEntityEndpointContract>;
export declare function getPriorityEntityEndpoint(importType: PriorityEntityImportType): PriorityEntityEndpointContract;
export declare function buildEntityCollectionUrl(serviceRoot: string, importType: PriorityEntityImportType, entitySetOverride?: string | null): string;
export interface PriorityCreditNoteContract {
    strategy: "negative_invoice";
    entitySet: "CINVOICES";
    debitField: "DEBIT";
    debitValueCredit: "C";
    debitValueInvoice: "D";
    amountField: "TOTPRICE";
    creditForField: "CREDITFOR";
    archaserCreditForField: "credit_for_invoice_number";
    separateCreditNoteEntity: false;
    pilotAction: "confirm_CREDITFOR_field_name_via_metadata";
}
/**
 * Credit notes ship as negative CINVOICES rows (D4), not a fifth import entity.
 * Map DEBIT='C' + negative TOTPRICE + CREDITFOR → credit_for_invoice_number.
 */
export declare const PRIORITY_CREDIT_NOTE_HANDLING: PriorityCreditNoteContract;
export interface PriorityTimezoneContract {
    fieldFormat: "DateTimeOffset";
    serverConstant: "TZSERVER";
    behavior: "server_tz_when_TZSERVER_off" | "company_tz_when_TZSERVER_on_and_company_set" | "server_tz_when_TZSERVER_on_but_no_company_tz";
    archaserNormalization: "Parse DateTimeOffset; store invoice/payment dates as UTC; display per account locale";
    incrementalRecommendation: "Always pass $since and filter watermarks in UTC (Z suffix)";
}
export declare const PRIORITY_TIMEZONE: PriorityTimezoneContract;
export type PriorityGateId = "deleted_records" | "token_refresh" | "sandbox_availability";
export interface PriorityGateOutcome {
    gate: PriorityGateId;
    answer: "yes" | "no" | "partial";
    mvpImpact: string;
    implementationNote: string;
}
export declare const PRIORITY_GATE_OUTCOMES: readonly PriorityGateOutcome[];
export interface OverlapWindowTestStep {
    step: number;
    action: string;
    expected: string;
}
/**
 * Procedure to validate incremental overlap before Phase 4b.
 * Run against sandbox or mock server with a mutable UDATE on one record.
 */
export declare const PRIORITY_OVERLAP_WINDOW_TEST: {
    overlapMinutes: number;
    scenario: string;
    steps: readonly OverlapWindowTestStep[];
    expectedUpsertBehavior: string;
};
export declare const PRIORITY_PII_FIELDS_TO_STRIP: Partial<Record<PriorityEntityImportType, readonly string[]>>;
export interface PriorityApiContract {
    provider: "PRIORITY";
    auth: PriorityAuthContract;
    transport: PriorityTransportContract;
    rateLimits: PriorityRateLimitContract;
    pagination: PriorityPaginationContract;
    incrementalFilter: PriorityIncrementalFilterContract;
    entities: Record<PriorityEntityImportType, PriorityEntityEndpointContract>;
    creditNotes: PriorityCreditNoteContract;
    timezone: PriorityTimezoneContract;
    gates: readonly PriorityGateOutcome[];
    overlapWindowTest: typeof PRIORITY_OVERLAP_WINDOW_TEST;
    samplePayloads: typeof SAMPLE_PAYLOADS_BY_IMPORT_TYPE;
    sandbox: {
        serviceRoot: string;
        credentials: PriorityBasicCredentials;
    };
}
export declare const priorityApiContract: PriorityApiContract;
/** Build incremental filter query string for an entity page request. */
export declare function buildIncrementalQueryParams(options: {
    watermarkIso: string;
    overlapMinutes: number;
    preferSince: boolean;
    top?: number;
    skip?: number;
}): Record<string, string>;
/** Type guard: ImportType is one of the four Priority MVP entities. */
export declare function isPriorityEntityImportType(importType: ImportType): importType is PriorityEntityImportType;
export default priorityApiContract;
