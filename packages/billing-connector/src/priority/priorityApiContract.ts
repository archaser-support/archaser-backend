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

import {
    CONTACT_SAMPLES,
    CUSTOMER_SAMPLES,
    INVOICE_SAMPLES,
    PAYMENT_SAMPLES,
    SAMPLE_PAYLOADS_BY_IMPORT_TYPE,
    type PriorityEntityImportType,
} from "./samplePayloads";

// Re-export sample payloads for mapper tests and mock server.
export {
    CONTACT_SAMPLES,
    CUSTOMER_SAMPLES,
    INVOICE_SAMPLES,
    PAYMENT_SAMPLES,
    SAMPLE_PAYLOADS_BY_IMPORT_TYPE,
    type PriorityEntityImportType,
};

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Connector auth modes supported by Archaser (see BillingConnector.credentials_encrypted). */
export type PriorityConnectorAuthType =
    | "API_KEY"
    | "OAUTH2_CLIENT_CREDENTIALS"
    | "BASIC";

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
export const PRIORITY_RECOMMENDED_AUTH_TYPE: PriorityConnectorAuthType = "API_KEY";

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

export type PriorityCredentialsEncrypted =
    | PriorityApiKeyCredentials
    | PriorityOAuth2Credentials
    | PriorityBasicCredentials;

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

export const PRIORITY_AUTH_CONTRACT: PriorityAuthContract = {
    authType: PRIORITY_RECOMMENDED_AUTH_TYPE,
    headerName: "Authorization",
    oauth2HeaderName: "Authorization",
    oauth2HeaderPrefix: "Bearer",
    optionalAppLicenseHeaders: ["X-App-Id", "X-App-Key"],
    credentialsShape: {
        API_KEY: ["token"],
        OAUTH2_CLIENT_CREDENTIALS: [
            "client_id",
            "client_secret",
            "token_endpoint",
            "access_token",
            "access_token_expires_at",
            "refresh_token",
        ],
        BASIC: ["username", "password"],
    },
};

// ---------------------------------------------------------------------------
// Base URL & transport
// ---------------------------------------------------------------------------

/**
 * OData service root pattern:
 * `{scheme}://{host}/odata/Priority/{tabula.ini}/{company_env}`
 *
 * Sandbox (Priority 25.0, AWS):
 * https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo
 */
export const PRIORITY_SANDBOX_SERVICE_ROOT =
    "https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo";

export const PRIORITY_SANDBOX_CREDENTIALS: PriorityBasicCredentials = {
    username: "apidemo",
    password: "123",
};

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

export const PRIORITY_TRANSPORT: PriorityTransportContract = {
    protocol: "OData v4 over HTTPS",
    defaultAccept: "application/json",
    dateFormat: "DateTimeOffset (YYYY-MM-DDTHH:MM:SS+HH:MM or Z)",
    maxPageSizeConstant: "MAXAPILINES (default 2000, v25.1+)",
    collectionWrapperKey: "value",
    totalCountHeader: null,
    totalCountStrategy: "iterate_until_short_page",
};

// ---------------------------------------------------------------------------
// Rate limits & retry
// ---------------------------------------------------------------------------

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

export const PRIORITY_RATE_LIMITS: PriorityRateLimitContract = {
    callsPerMinutePerUser: 100,
    maxParallelRequests: 10,
    maxQueuedRequests: 5,
    requestTimeoutSeconds: 180,
    throttleStatusCode: 429,
    retryAfterHeader: "Retry-After (not guaranteed)",
    recommendedBackoffSeconds: [5, 15, 30],
    recommendedPageSize: 500,
};

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

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

export const PRIORITY_PAGINATION: PriorityPaginationContract = {
    style: "odata_top_skip",
    topParam: "$top",
    skipParam: "$skip",
    defaultMaxRecords: 2000,
    recommendedTop: 500,
    terminationRule: "short_page",
};

// ---------------------------------------------------------------------------
// Incremental sync
// ---------------------------------------------------------------------------

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

export const PRIORITY_INCREMENTAL_FILTER: PriorityIncrementalFilterContract = {
    primary: "since",
    fallback: "filter_udate",
    sinceParam: "$since",
    sinceFormat: "UTC with Z suffix (e.g. 2025-06-01T07:25:00Z)",
    udateField: "UDATE",
    overlapMinutesDefault: 5,
    overlapDuringBackfill: 0,
};

// ---------------------------------------------------------------------------
// Entity endpoints
// ---------------------------------------------------------------------------

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

export const PRIORITY_ENTITY_ENDPOINTS: Record<
    PriorityEntityImportType,
    PriorityEntityEndpointContract
> = {
    Customer: {
        importType: "Customer",
        entitySet: "CUSTOMERS",
        path: "CUSTOMERS",
        erpPrimaryKeyFields: ["CUSTNAME"],
        archaserIdField: "customer_number",
        incrementalFilter: PRIORITY_INCREMENTAL_FILTER,
        pagination: PRIORITY_PAGINATION,
        discoveryFields: [
            "CUSTNAME",
            "CDES",
            "CUSTDES",
            "EMAIL",
            "PHONE",
            "COUNTRYNAME",
            "COUNTRYCODE",
            "STATE",
            "STATECODE",
            "STATEA",
            "ADDRESS",
            "ADDRESS2",
            "ZIP",
            "WTAXNUM",
            "UDATE",
            "IDG_COMPANYNAME",
            "MCUSTNAME",
        ],
        notes:
            "CUSTNAME is the documented customer number (Customer Number). Maps 1:1 to Archaser customer_number.",
    },
    Contact: {
        importType: "Contact",
        entitySet: "CUSTPERSONNEL",
        path: "CUSTPERSONNEL",
        erpPrimaryKeyFields: ["KLINE"],
        archaserIdField: "erp_contact_id",
        incrementalFilter: PRIORITY_INCREMENTAL_FILTER,
        pagination: PRIORITY_PAGINATION,
        discoveryFields: [
            "KLINE",
            "CUSTNAME",
            "NAME",
            "FIRSTNAME",
            "LASTNAME",
            "EMAIL",
            "PHONE",
            "CELLPHONE",
            "POSITIONDES",
            "UDATE",
        ],
        notes:
            "KLINE is the internal line key; confirm via metadata. CUSTNAME links to customer_number. Composite environments may require `${CUSTNAME}|${NAME}` — confirm during pilot.",
    },
    Invoice: {
        importType: "Invoice",
        entitySet: "CINVOICES",
        path: "CINVOICES",
        erpPrimaryKeyFields: ["IVNUM", "IVTYPE"],
        archaserIdField: "invoice_number",
        incrementalFilter: PRIORITY_INCREMENTAL_FILTER,
        pagination: PRIORITY_PAGINATION,
        discoveryFields: [
            "IVNUM",
            "IVTYPE",
            "DEBIT",
            "CUSTNAME",
            "IVDATE",
            "DUEDATE",
            "TOTPRICE",
            "CODE",
            "STATDES",
            "CREDITFOR",
            "UDATE",
        ],
        notes:
            "Composite OData key (IVNUM, IVTYPE). Credit notes: DEBIT='C' with negative TOTPRICE; CREDITFOR links to original IVNUM (see credit note section).",
    },
    Payment: {
        importType: "Payment",
        entitySet: "TOTARPAY",
        path: "TOTARPAY",
        erpPrimaryKeyFields: ["PAYNUM"],
        archaserIdField: "reference",
        incrementalFilter: PRIORITY_INCREMENTAL_FILTER,
        pagination: PRIORITY_PAGINATION,
        discoveryFields: [
            "PAYNUM",
            "CUSTNAME",
            "IVNUM",
            "IVTYPE",
            "PAYDATE",
            "PAYMENT",
            "CODE",
            "PAYMENTCODE",
            "PAYDES",
            "UDATE",
        ],
        notes:
            "TOTARPAY = Total AR Payment receipts. Confirm entity set name per deployment (some sites expose RECEIPT or FNCPAYMENTS). PAYNUM → Archaser reference; immutable skip-if-exists (D3).",
    },
};

export function getPriorityEntityEndpoint(
    importType: PriorityEntityImportType
): PriorityEntityEndpointContract {
    return PRIORITY_ENTITY_ENDPOINTS[importType];
}

export function buildEntityCollectionUrl(
    serviceRoot: string,
    importType: PriorityEntityImportType,
    entitySetOverride?: string | null
): string {
    const base = serviceRoot.replace(/\/$/, "");
    const path =
        entitySetOverride && entitySetOverride.trim()
            ? entitySetOverride.trim()
            : PRIORITY_ENTITY_ENDPOINTS[importType].path;
    return `${base}/${path}`;
}

// ---------------------------------------------------------------------------
// Credit notes (D4)
// ---------------------------------------------------------------------------

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
export const PRIORITY_CREDIT_NOTE_HANDLING: PriorityCreditNoteContract = {
    strategy: "negative_invoice",
    entitySet: "CINVOICES",
    debitField: "DEBIT",
    debitValueCredit: "C",
    debitValueInvoice: "D",
    amountField: "TOTPRICE",
    creditForField: "CREDITFOR",
    archaserCreditForField: "credit_for_invoice_number",
    separateCreditNoteEntity: false,
    pilotAction: "confirm_CREDITFOR_field_name_via_metadata",
};

// ---------------------------------------------------------------------------
// Timezone
// ---------------------------------------------------------------------------

export interface PriorityTimezoneContract {
    fieldFormat: "DateTimeOffset";
    serverConstant: "TZSERVER";
    behavior:
        | "server_tz_when_TZSERVER_off"
        | "company_tz_when_TZSERVER_on_and_company_set"
        | "server_tz_when_TZSERVER_on_but_no_company_tz";
    archaserNormalization:
        "Parse DateTimeOffset; store invoice/payment dates as UTC; display per account locale";
    incrementalRecommendation: "Always pass $since and filter watermarks in UTC (Z suffix)";
}

export const PRIORITY_TIMEZONE: PriorityTimezoneContract = {
    fieldFormat: "DateTimeOffset",
    serverConstant: "TZSERVER",
    behavior: "company_tz_when_TZSERVER_on_and_company_set",
    archaserNormalization:
        "Parse DateTimeOffset; store invoice/payment dates as UTC; display per account locale",
    incrementalRecommendation:
        "Always pass $since and filter watermarks in UTC (Z suffix)",
};

// ---------------------------------------------------------------------------
// Phase 0 outcome gates
// ---------------------------------------------------------------------------

export type PriorityGateId =
    | "deleted_records"
    | "token_refresh"
    | "sandbox_availability";

export interface PriorityGateOutcome {
    gate: PriorityGateId;
    answer: "yes" | "no" | "partial";
    mvpImpact: string;
    implementationNote: string;
}

export const PRIORITY_GATE_OUTCOMES: readonly PriorityGateOutcome[] = [
    {
        gate: "deleted_records",
        answer: "no",
        mvpImpact:
            "No delete-sync in MVP. Priority OData supports DELETE on some entities but does not expose a deleted-records changelog feed.",
        implementationNote:
            "Document as known gap. Archaser records removed in Priority remain until manual cleanup. Revisit post-pilot if Priority exposes change log.",
    },
    {
        gate: "token_refresh",
        answer: "partial",
        mvpImpact:
            "PAT/API_KEY auth has no mid-session expiry — no refresh needed for default connector path. OAuth2 (External ID) tokens expire; refresh via token_endpoint required.",
        implementationNote:
            "Default auth_type=API_KEY. If pilot uses OAuth2 and token lifetime < 1h, implement refresh in PriorityClient before Phase 4b; otherwise treat expiry as auth error → circuit breaker.",
    },
    {
        gate: "sandbox_availability",
        answer: "yes",
        mvpImpact:
            "Official sandbox available for manual/integration validation. CI uses mock server + recorded fixtures to avoid network dependency.",
        implementationNote: `Sandbox: ${PRIORITY_SANDBOX_SERVICE_ROOT} (apidemo/123). Local: npx tsx scripts/testing/priority-mock-server.ts`,
    },
];

// ---------------------------------------------------------------------------
// Overlap window test (documented procedure)
// ---------------------------------------------------------------------------

export interface OverlapWindowTestStep {
    step: number;
    action: string;
    expected: string;
}

/**
 * Procedure to validate incremental overlap before Phase 4b.
 * Run against sandbox or mock server with a mutable UDATE on one record.
 */
export const PRIORITY_OVERLAP_WINDOW_TEST: {
    overlapMinutes: number;
    scenario: string;
    steps: readonly OverlapWindowTestStep[];
    expectedUpsertBehavior: string;
} = {
    overlapMinutes: 5,
    scenario:
        "Change a customer in Priority (or bump UDATE in mock), re-pull with 5-minute overlap on incremental watermark.",
    steps: [
        {
            step: 1,
            action:
                "Run INCREMENTAL sync for Customer; record watermark W = max(UDATE) from pulled rows.",
            expected: "Customer T000001 upserted once in Archaser.",
        },
        {
            step: 2,
            action:
                "Update CDES for T000001 in Priority (or mock: set UDATE = now).",
            expected: "UDATE advances past W.",
        },
        {
            step: 3,
            action:
                "Run INCREMENTAL sync with filter `$since={W minus 5 minutes}` (or UDATE ge W-5m).",
            expected:
                "T000001 returned again in ERP page (overlap window includes the change).",
        },
        {
            step: 4,
            action: "Import pipeline upserts by (account_id, customer_number).",
            expected:
                "Exactly one Customer row for T000001 — no duplicate. `entity_stats.updated++`, not `created++`.",
        },
    ],
    expectedUpsertBehavior:
        "Overlap re-pull may return the same ERP PK multiple times across runs; Archaser upsert by natural key prevents duplicates. Payment entity skips silently if reference exists (D10).",
};

// ---------------------------------------------------------------------------
// PII fields to strip before persistence (post-mapping)
// ---------------------------------------------------------------------------

export const PRIORITY_PII_FIELDS_TO_STRIP: Partial<
    Record<PriorityEntityImportType, readonly string[]>
> = {
    Contact: ["PHONE", "CELLPHONE"],
    Customer: ["PHONE"],
};

// ---------------------------------------------------------------------------
// Full contract export
// ---------------------------------------------------------------------------

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

export const priorityApiContract: PriorityApiContract = {
    provider: "PRIORITY",
    auth: PRIORITY_AUTH_CONTRACT,
    transport: PRIORITY_TRANSPORT,
    rateLimits: PRIORITY_RATE_LIMITS,
    pagination: PRIORITY_PAGINATION,
    incrementalFilter: PRIORITY_INCREMENTAL_FILTER,
    entities: PRIORITY_ENTITY_ENDPOINTS,
    creditNotes: PRIORITY_CREDIT_NOTE_HANDLING,
    timezone: PRIORITY_TIMEZONE,
    gates: PRIORITY_GATE_OUTCOMES,
    overlapWindowTest: PRIORITY_OVERLAP_WINDOW_TEST,
    samplePayloads: SAMPLE_PAYLOADS_BY_IMPORT_TYPE,
    sandbox: {
        serviceRoot: PRIORITY_SANDBOX_SERVICE_ROOT,
        credentials: PRIORITY_SANDBOX_CREDENTIALS,
    },
};

/** Build incremental filter query string for an entity page request. */
export function buildIncrementalQueryParams(options: {
    watermarkIso: string;
    overlapMinutes: number;
    preferSince: boolean;
    top?: number;
    skip?: number;
}): Record<string, string> {
    const { watermarkIso, overlapMinutes, preferSince, top, skip } = options;
    const watermarkMs = Date.parse(watermarkIso);
    const overlapMs = overlapMinutes * 60 * 1000;
    const sinceIso = new Date(watermarkMs - overlapMs).toISOString();

    const params: Record<string, string> = {};

    if (preferSince) {
        params.$since = sinceIso;
    } else {
        params.$filter = `UDATE ge ${sinceIso}`;
    }

    if (top !== undefined) {
        params.$top = String(top);
    }
    if (skip !== undefined) {
        params.$skip = String(skip);
    }

    return params;
}

/** Type guard: ImportType is one of the four Priority MVP entities. */
export function isPriorityEntityImportType(
    importType: ImportType
): importType is PriorityEntityImportType {
    return (
        importType === "Customer" ||
        importType === "Contact" ||
        importType === "Invoice" ||
        importType === "Payment"
    );
}

export default priorityApiContract;
