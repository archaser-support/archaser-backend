"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SWAGGER_DESCRIPTION = void 0;
exports.enrichStranglerOpenApi = enrichStranglerOpenApi;
const route_catalog_constants_1 = require("../domain/route-catalog.constants");
const CREDIT_INSURANCE_PATHS = [
    "summary",
    "summary-history",
    "portfolio-health",
    "customer-dashboard-kpis",
    "customer-policy-trend",
    "report",
    "insurance-policy-trend",
    "mark-reported",
    "mark-reported-bulk",
];
const IMPORT_LEAVES = [
    "payment",
    "customer",
    "contact",
    "invoice",
    "policy",
];
const PORTAL_CUSTOMER_SUFFIXES = [
    "portal-data",
    "agent-portal",
    "invoices",
    "bank-details",
    "banks",
    "disputes",
    "create-dispute",
    "view-disputes",
    "wrong-contact",
    "top-ups",
];
function methods(summary, tag, opts = {}) {
    const security = opts.public ? [] : [{ bearer: [] }];
    const responses = {
        "200": { description: "OK (legacy Pages API shape)" },
        "401": { description: "Unauthorized" },
        "404": { description: "Not found / not strangler’d" },
    };
    const op = {
        tags: [tag],
        summary,
        security,
        responses,
    };
    return {
        get: { ...op },
        post: { ...op },
        put: { ...op },
        patch: { ...op },
        delete: { ...op },
    };
}
function mergePath(document, path, item) {
    document.paths = document.paths || {};
    const existing = document.paths[path] || {};
    document.paths[path] = { ...existing, ...item };
}
function enrichStranglerOpenApi(document) {
    for (const leaf of IMPORT_LEAVES) {
        mergePath(document, `/api/import/${leaf}`, methods(`Import ${leaf}`, "import"));
    }
    mergePath(document, "/api/import/job/create", methods("Create import job", "import"));
    mergePath(document, "/api/import/job/complete", methods("Complete import job", "import"));
    mergePath(document, "/api/import/job/{jobId}", methods("Import job by id", "import"));
    for (const entity of route_catalog_constants_1.NEST_DOMAIN_ENTITY_TYPES) {
        mergePath(document, `/api/entities/${entity}`, methods(`Entity list/create — ${entity}`, "entities"));
        mergePath(document, `/api/entities/${entity}/{id}`, methods(`Entity by id — ${entity}`, "entities"));
    }
    for (const op of route_catalog_constants_1.OPERATION_TYPES) {
        mergePath(document, `/api/operations/${op}`, methods(`Operations — ${op}`, "operations"));
        mergePath(document, `/api/operations/${op}/{id}`, methods(`Operations by id — ${op}`, "operations"));
    }
    for (const leaf of CREDIT_INSURANCE_PATHS) {
        mergePath(document, `/api/credit-insurance/${leaf}`, methods(`Credit insurance — ${leaf}`, "credit-insurance"));
    }
    mergePath(document, "/api/portal/create-dispute", methods("Portal create-dispute", "portal", { public: true }));
    mergePath(document, "/api/portal/update-promise-to-pay", methods("Portal update-promise-to-pay", "portal", { public: true }));
    for (const suffix of PORTAL_CUSTOMER_SUFFIXES) {
        mergePath(document, `/api/customers/{customerUUID}/${suffix}`, methods(`Portal customer — ${suffix}`, "portal-customers", {
            public: true,
        }));
    }
    mergePath(document, "/api/ws/{path}", {
        get: {
            tags: ["proxy-keep-on-next"],
            summary: "WebSocket — keep on Next at reverse proxy (D2=A); Nest does not own upgrades",
            responses: {
                "501": {
                    description: "Must terminate on Next, not Nest",
                },
            },
        },
    });
    mergePath(document, "/api/auth/{path}", {
        get: {
            tags: ["proxy-keep-on-next"],
            summary: "NextAuth — keep on Next at reverse proxy until Amplify cutover (D2=A)",
            responses: {
                "200": { description: "Served by Next pages/api/auth" },
            },
        },
    });
    mergePath(document, "/api/gateway/sms/send", methods("Gateway → SMS send", "gateway-peel"));
    mergePath(document, "/api/gateway/connectors/{accountId}/sync", methods("Gateway → connectors sync", "gateway-peel"));
    mergePath(document, "/api/gateway/reports/{id}/execute", methods("Gateway → reports execute", "gateway-peel"));
    mergePath(document, "/api/gateway/cron/sync-schedules", methods("Enqueue CronJob schedule sync", "cron-queue"));
    mergePath(document, "/api/gateway/cron/{jobId}/run-now", methods("Enqueue CronJob run-now", "cron-queue"));
    return document;
}
exports.SWAGGER_DESCRIPTION = "Archaser Nest API — Nest-native product HTTP (reports, system, activities, search, " +
    "roles/permissions, entities, operations, import, portal, credit-insurance, gateway, and more). " +
    "D2=A: reverse proxy keeps /api/ws and /api/auth on Next.";
//# sourceMappingURL=enrich-strangler-openapi.js.map