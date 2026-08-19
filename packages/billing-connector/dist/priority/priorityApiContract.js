"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.priorityApiContract = exports.PRIORITY_PII_FIELDS_TO_STRIP = exports.PRIORITY_OVERLAP_WINDOW_TEST = exports.PRIORITY_GATE_OUTCOMES = exports.PRIORITY_TIMEZONE = exports.PRIORITY_CREDIT_NOTE_HANDLING = exports.PRIORITY_ENTITY_ENDPOINTS = exports.PRIORITY_INCREMENTAL_FILTER = exports.PRIORITY_PAGINATION = exports.PRIORITY_RATE_LIMITS = exports.PRIORITY_TRANSPORT = exports.PRIORITY_SANDBOX_CREDENTIALS = exports.PRIORITY_SANDBOX_SERVICE_ROOT = exports.PRIORITY_AUTH_CONTRACT = exports.PRIORITY_RECOMMENDED_AUTH_TYPE = exports.SAMPLE_PAYLOADS_BY_IMPORT_TYPE = exports.PAYMENT_SAMPLES = exports.INVOICE_SAMPLES = exports.CUSTOMER_SAMPLES = exports.CONTACT_SAMPLES = void 0;
exports.getPriorityEntityEndpoint = getPriorityEntityEndpoint;
exports.buildEntityCollectionUrl = buildEntityCollectionUrl;
exports.buildIncrementalQueryParams = buildIncrementalQueryParams;
exports.isPriorityEntityImportType = isPriorityEntityImportType;
const samplePayloads_1 = require("./samplePayloads");
Object.defineProperty(exports, "CONTACT_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.CONTACT_SAMPLES; } });
Object.defineProperty(exports, "CUSTOMER_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.CUSTOMER_SAMPLES; } });
Object.defineProperty(exports, "INVOICE_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.INVOICE_SAMPLES; } });
Object.defineProperty(exports, "PAYMENT_SAMPLES", { enumerable: true, get: function () { return samplePayloads_1.PAYMENT_SAMPLES; } });
Object.defineProperty(exports, "SAMPLE_PAYLOADS_BY_IMPORT_TYPE", { enumerable: true, get: function () { return samplePayloads_1.SAMPLE_PAYLOADS_BY_IMPORT_TYPE; } });
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
exports.PRIORITY_RECOMMENDED_AUTH_TYPE = "API_KEY";
exports.PRIORITY_AUTH_CONTRACT = {
    authType: exports.PRIORITY_RECOMMENDED_AUTH_TYPE,
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
exports.PRIORITY_SANDBOX_SERVICE_ROOT = "https://t.eu.priority-connect.online/odata/Priority/tabbtd38.ini/usdemo";
exports.PRIORITY_SANDBOX_CREDENTIALS = {
    username: "apidemo",
    password: "123",
};
exports.PRIORITY_TRANSPORT = {
    protocol: "OData v4 over HTTPS",
    defaultAccept: "application/json",
    dateFormat: "DateTimeOffset (YYYY-MM-DDTHH:MM:SS+HH:MM or Z)",
    maxPageSizeConstant: "MAXAPILINES (default 2000, v25.1+)",
    collectionWrapperKey: "value",
    totalCountHeader: null,
    totalCountStrategy: "iterate_until_short_page",
};
exports.PRIORITY_RATE_LIMITS = {
    callsPerMinutePerUser: 100,
    maxParallelRequests: 10,
    maxQueuedRequests: 5,
    requestTimeoutSeconds: 180,
    throttleStatusCode: 429,
    retryAfterHeader: "Retry-After (not guaranteed)",
    recommendedBackoffSeconds: [5, 15, 30],
    recommendedPageSize: 500,
};
exports.PRIORITY_PAGINATION = {
    style: "odata_top_skip",
    topParam: "$top",
    skipParam: "$skip",
    defaultMaxRecords: 2000,
    recommendedTop: 500,
    terminationRule: "short_page",
};
exports.PRIORITY_INCREMENTAL_FILTER = {
    primary: "since",
    fallback: "filter_udate",
    sinceParam: "$since",
    sinceFormat: "UTC with Z suffix (e.g. 2025-06-01T07:25:00Z)",
    udateField: "UDATE",
    overlapMinutesDefault: 5,
    overlapDuringBackfill: 0,
};
exports.PRIORITY_ENTITY_ENDPOINTS = {
    Customer: {
        importType: "Customer",
        entitySet: "CUSTOMERS",
        path: "CUSTOMERS",
        erpPrimaryKeyFields: ["CUSTNAME"],
        archaserIdField: "customer_number",
        incrementalFilter: exports.PRIORITY_INCREMENTAL_FILTER,
        pagination: exports.PRIORITY_PAGINATION,
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
        defaultOrderBy: "CUSTNAME",
        notes: "CUSTNAME is the documented customer number (Customer Number). Maps 1:1 to Archaser customer_number.",
    },
    Contact: {
        importType: "Contact",
        entitySet: "CUSTPERSONNEL",
        path: "CUSTPERSONNEL",
        erpPrimaryKeyFields: ["KLINE"],
        archaserIdField: "erp_contact_id",
        incrementalFilter: exports.PRIORITY_INCREMENTAL_FILTER,
        pagination: exports.PRIORITY_PAGINATION,
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
        defaultOrderBy: "KLINE",
        notes: "KLINE is the internal line key; confirm via metadata. CUSTNAME links to customer_number. Composite environments may require `${CUSTNAME}|${NAME}` — confirm during pilot.",
    },
    Invoice: {
        importType: "Invoice",
        entitySet: "CINVOICES",
        path: "CINVOICES",
        erpPrimaryKeyFields: ["IVNUM", "IVTYPE"],
        archaserIdField: "invoice_number",
        incrementalFilter: exports.PRIORITY_INCREMENTAL_FILTER,
        pagination: exports.PRIORITY_PAGINATION,
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
        defaultOrderBy: "IVNUM",
        notes: "Composite OData key (IVNUM, IVTYPE). Credit notes: DEBIT='C' with negative TOTPRICE; CREDITFOR links to original IVNUM (see credit note section).",
    },
    Payment: {
        importType: "Payment",
        entitySet: "TOTARPAY",
        path: "TOTARPAY",
        erpPrimaryKeyFields: ["PAYNUM"],
        archaserIdField: "reference",
        incrementalFilter: exports.PRIORITY_INCREMENTAL_FILTER,
        pagination: exports.PRIORITY_PAGINATION,
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
        defaultOrderBy: "PAYNUM",
        notes: "TOTARPAY = Total AR Payment receipts. Confirm entity set name per deployment (some sites expose RECEIPT or FNCPAYMENTS / TINVOICES). PAYNUM → Archaser reference; immutable skip-if-exists (D3). Related-payment pulls for dated backfill filter on IVNUM + CUSTNAME (see PRIORITY_DATED_BACKFILL_FILTERS).",
    },
};
function getPriorityEntityEndpoint(importType) {
    return exports.PRIORITY_ENTITY_ENDPOINTS[importType];
}
function buildEntityCollectionUrl(serviceRoot, importType, entitySetOverride) {
    const base = serviceRoot.replace(/\/$/, "");
    const path = entitySetOverride && entitySetOverride.trim()
        ? entitySetOverride.trim()
        : exports.PRIORITY_ENTITY_ENDPOINTS[importType].path;
    return `${base}/${path}`;
}
/**
 * Credit notes ship as negative CINVOICES rows (D4), not a fifth import entity.
 * In Priority ERP (iDigil), credit notes reference target invoices via sub-screen
 * CINVOICESCONT (CINVOICESCONT_SUBFORM in OData), field PIVNUM -> credit_for_invoice_number.
 */
exports.PRIORITY_CREDIT_NOTE_HANDLING = {
    strategy: "negative_invoice",
    entitySet: "CINVOICES",
    subformSet: "CINVOICESCONT_SUBFORM",
    debitField: "DEBIT",
    debitValueCredit: "C",
    debitValueInvoice: "D",
    amountField: "TOTPRICE",
    creditForField: "PIVNUM",
    archaserCreditForField: "credit_for_invoice_number",
    separateCreditNoteEntity: false,
    pilotAction: "confirm_CREDITFOR_field_name_via_metadata",
};
exports.PRIORITY_TIMEZONE = {
    fieldFormat: "DateTimeOffset",
    serverConstant: "TZSERVER",
    behavior: "company_tz_when_TZSERVER_on_and_company_set",
    archaserNormalization: "Parse DateTimeOffset; store invoice/payment dates as UTC; display per account locale",
    incrementalRecommendation: "Always pass $since and filter watermarks in UTC (Z suffix)",
};
exports.PRIORITY_GATE_OUTCOMES = [
    {
        gate: "deleted_records",
        answer: "no",
        mvpImpact: "No delete-sync in MVP. Priority OData supports DELETE on some entities but does not expose a deleted-records changelog feed.",
        implementationNote: "Document as known gap. Archaser records removed in Priority remain until manual cleanup. Revisit post-pilot if Priority exposes change log.",
    },
    {
        gate: "token_refresh",
        answer: "partial",
        mvpImpact: "PAT/API_KEY auth has no mid-session expiry — no refresh needed for default connector path. OAuth2 (External ID) tokens expire; refresh via token_endpoint required.",
        implementationNote: "Default auth_type=API_KEY. If pilot uses OAuth2 and token lifetime < 1h, implement refresh in PriorityClient before Phase 4b; otherwise treat expiry as auth error → circuit breaker.",
    },
    {
        gate: "sandbox_availability",
        answer: "yes",
        mvpImpact: "Official sandbox available for manual/integration validation. CI uses mock server + recorded fixtures to avoid network dependency.",
        implementationNote: `Sandbox: ${exports.PRIORITY_SANDBOX_SERVICE_ROOT} (apidemo/123). Local: npx tsx scripts/testing/priority-mock-server.ts`,
    },
];
/**
 * Procedure to validate incremental overlap before Phase 4b.
 * Run against sandbox or mock server with a mutable UDATE on one record.
 */
exports.PRIORITY_OVERLAP_WINDOW_TEST = {
    overlapMinutes: 5,
    scenario: "Change a customer in Priority (or bump UDATE in mock), re-pull with 5-minute overlap on incremental watermark.",
    steps: [
        {
            step: 1,
            action: "Run INCREMENTAL sync for Customer; record watermark W = max(UDATE) from pulled rows.",
            expected: "Customer T000001 upserted once in Archaser.",
        },
        {
            step: 2,
            action: "Update CDES for T000001 in Priority (or mock: set UDATE = now).",
            expected: "UDATE advances past W.",
        },
        {
            step: 3,
            action: "Run INCREMENTAL sync with filter `$since={W minus 5 minutes}` (or UDATE ge W-5m).",
            expected: "T000001 returned again in ERP page (overlap window includes the change).",
        },
        {
            step: 4,
            action: "Import pipeline upserts by (account_id, customer_number).",
            expected: "Exactly one Customer row for T000001 — no duplicate. `entity_stats.updated++`, not `created++`.",
        },
    ],
    expectedUpsertBehavior: "Overlap re-pull may return the same ERP PK multiple times across runs; Archaser upsert by natural key prevents duplicates. Payment entity skips silently if reference exists (D10).",
};
// ---------------------------------------------------------------------------
// PII fields to strip before persistence (post-mapping)
// ---------------------------------------------------------------------------
exports.PRIORITY_PII_FIELDS_TO_STRIP = {
    Contact: ["PHONE", "CELLPHONE"],
    Customer: ["PHONE"],
};
exports.priorityApiContract = {
    provider: "PRIORITY",
    auth: exports.PRIORITY_AUTH_CONTRACT,
    transport: exports.PRIORITY_TRANSPORT,
    rateLimits: exports.PRIORITY_RATE_LIMITS,
    pagination: exports.PRIORITY_PAGINATION,
    incrementalFilter: exports.PRIORITY_INCREMENTAL_FILTER,
    entities: exports.PRIORITY_ENTITY_ENDPOINTS,
    creditNotes: exports.PRIORITY_CREDIT_NOTE_HANDLING,
    timezone: exports.PRIORITY_TIMEZONE,
    gates: exports.PRIORITY_GATE_OUTCOMES,
    overlapWindowTest: exports.PRIORITY_OVERLAP_WINDOW_TEST,
    samplePayloads: samplePayloads_1.SAMPLE_PAYLOADS_BY_IMPORT_TYPE,
    sandbox: {
        serviceRoot: exports.PRIORITY_SANDBOX_SERVICE_ROOT,
        credentials: exports.PRIORITY_SANDBOX_CREDENTIALS,
    },
};
/** Build incremental filter query string for an entity page request. */
function buildIncrementalQueryParams(options) {
    const { watermarkIso, overlapMinutes, preferSince, top, skip } = options;
    const watermarkMs = Date.parse(watermarkIso);
    const overlapMs = overlapMinutes * 60 * 1000;
    const sinceIso = new Date(watermarkMs - overlapMs).toISOString();
    const params = {};
    if (preferSince) {
        params.$since = sinceIso;
    }
    else {
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
function isPriorityEntityImportType(importType) {
    return (importType === "Customer" ||
        importType === "Contact" ||
        importType === "Invoice" ||
        importType === "Payment");
}
exports.default = exports.priorityApiContract;
