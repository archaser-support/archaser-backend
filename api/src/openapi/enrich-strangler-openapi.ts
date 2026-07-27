import { OpenAPIObject, PathItemObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";
import {
    NEST_DOMAIN_ENTITY_TYPES,
    OPERATION_TYPES,
} from "../domain/route-catalog.constants";

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
] as const;

const IMPORT_LEAVES = [
    "payment",
    "customer",
    "contact",
    "invoice",
    "policy",
] as const;

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
] as const;

function methods(
    summary: string,
    tag: string,
    opts: { public?: boolean } = {}
): PathItemObject {
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

function mergePath(
    document: OpenAPIObject,
    path: string,
    item: PathItemObject
): void {
    document.paths = document.paths || {};
    const existing = document.paths[path] || {};
    document.paths[path] = { ...existing, ...item };
}

/**
 * Nest `@All(":param")` catch-all-style handlers (entities/operations/credit-insurance/
 * portal leaf routes) don't expand into useful Swagger entries on their own.
 * This fills the published OpenAPI with the real entity/operation type catalog.
 */
export function enrichStranglerOpenApi(
    document: OpenAPIObject
): OpenAPIObject {
    for (const leaf of IMPORT_LEAVES) {
        mergePath(
            document,
            `/api/import/${leaf}`,
            methods(`Import ${leaf}`, "import")
        );
    }
    mergePath(
        document,
        "/api/import/job/create",
        methods("Create import job", "import")
    );
    mergePath(
        document,
        "/api/import/job/complete",
        methods("Complete import job", "import")
    );
    mergePath(
        document,
        "/api/import/job/{jobId}",
        methods("Import job by id", "import")
    );

    for (const entity of NEST_DOMAIN_ENTITY_TYPES) {
        mergePath(
            document,
            `/api/entities/${entity}`,
            methods(`Entity list/create — ${entity}`, "entities")
        );
        mergePath(
            document,
            `/api/entities/${entity}/{id}`,
            methods(`Entity by id — ${entity}`, "entities")
        );
    }

    for (const op of OPERATION_TYPES) {
        mergePath(
            document,
            `/api/operations/${op}`,
            methods(`Operations — ${op}`, "operations")
        );
        mergePath(
            document,
            `/api/operations/${op}/{id}`,
            methods(`Operations by id — ${op}`, "operations")
        );
    }

    for (const leaf of CREDIT_INSURANCE_PATHS) {
        mergePath(
            document,
            `/api/credit-insurance/${leaf}`,
            methods(`Credit insurance — ${leaf}`, "credit-insurance")
        );
    }

    mergePath(
        document,
        "/api/portal/create-dispute",
        methods("Portal create-dispute", "portal", { public: true })
    );
    mergePath(
        document,
        "/api/portal/update-promise-to-pay",
        methods("Portal update-promise-to-pay", "portal", { public: true })
    );

    for (const suffix of PORTAL_CUSTOMER_SUFFIXES) {
        mergePath(
            document,
            `/api/customers/{customerUUID}/${suffix}`,
            methods(`Portal customer — ${suffix}`, "portal-customers", {
                public: true,
            })
        );
    }

    // D2=A — documented Next-only proxy exclusions (not Nest handlers)
    mergePath(document, "/api/ws/{path}", {
        get: {
            tags: ["proxy-keep-on-next"],
            summary:
                "WebSocket — keep on Next at reverse proxy (D2=A); Nest does not own upgrades",
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
            summary:
                "NextAuth — keep on Next at reverse proxy until Amplify cutover (D2=A)",
            responses: {
                "200": { description: "Served by Next pages/api/auth" },
            },
        },
    });

    mergePath(
        document,
        "/api/gateway/sms/send",
        methods("Gateway → SMS send", "gateway-peel")
    );
    mergePath(
        document,
        "/api/gateway/connectors/{accountId}/sync",
        methods("Gateway → connectors sync", "gateway-peel")
    );
    mergePath(
        document,
        "/api/gateway/reports/{id}/execute",
        methods("Gateway → reports execute", "gateway-peel")
    );
    mergePath(
        document,
        "/api/gateway/cron/sync-schedules",
        methods("Enqueue CronJob schedule sync", "cron-queue")
    );
    mergePath(
        document,
        "/api/gateway/cron/{jobId}/run-now",
        methods("Enqueue CronJob run-now", "cron-queue")
    );

    return document;
}

export const SWAGGER_DESCRIPTION =
    "Archaser Nest API — Nest-native product HTTP (reports, system, activities, search, " +
    "roles/permissions, entities, operations, import, portal, credit-insurance, gateway, and more). " +
    "D2=A: reverse proxy keeps /api/ws and /api/auth on Next.";
