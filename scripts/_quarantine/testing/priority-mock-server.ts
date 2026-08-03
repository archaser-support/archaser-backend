#!/usr/bin/env tsx

/**
 * Minimal Priority OData mock server for local PriorityClient development.
 *
 * Usage:
 *   npx tsx scripts/testing/priority-mock-server.ts
 *   PRIORITY_MOCK_PORT=4010 npx tsx scripts/testing/priority-mock-server.ts
 *
 * Default base URL (service root):
 *   http://127.0.0.1:4010/odata/Priority/mock.ini/demo
 *
 * Auth: any non-empty Basic credentials (username/password).
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { URL } from "url";

import {
    PRIORITY_ENTITY_ENDPOINTS,
    PRIORITY_RATE_LIMITS,
    type PriorityEntityImportType,
} from "../../frontend/server/integrations/priority/priorityApiContract";
import { SAMPLE_PAYLOADS_BY_IMPORT_TYPE } from "../../frontend/server/integrations/priority/fixtures/samplePayloads";

const DEFAULT_PORT = Number(process.env.PRIORITY_MOCK_PORT ?? 4010);
const SERVICE_ROOT_PATH = "/odata/Priority/mock.ini/demo";

type MutableRecord = Record<string, unknown>;

const ENTITY_SET_TO_IMPORT_TYPE = Object.fromEntries(
    Object.values(PRIORITY_ENTITY_ENDPOINTS).map((entity) => [
        entity.entitySet,
        entity.importType,
    ])
) as Record<string, PriorityEntityImportType>;

/** In-memory store — cloned from fixtures so UDATE can be mutated for overlap tests. */
const store: Record<PriorityEntityImportType, MutableRecord[]> = {
    Customer: SAMPLE_PAYLOADS_BY_IMPORT_TYPE.Customer.map((row) => ({ ...row })),
    Contact: SAMPLE_PAYLOADS_BY_IMPORT_TYPE.Contact.map((row) => ({ ...row })),
    Invoice: SAMPLE_PAYLOADS_BY_IMPORT_TYPE.Invoice.map((row) => ({ ...row })),
    Payment: SAMPLE_PAYLOADS_BY_IMPORT_TYPE.Payment.map((row) => ({ ...row })),
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
}

function parseBasicAuth(header: string | undefined): boolean {
    if (!header?.startsWith("Basic ")) {
        return false;
    }
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) {
        return false;
    }
    const username = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    return username.length > 0 && password.length > 0;
}

function parseQuery(url: URL): Record<string, string> {
    const params: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
        params[key] = value;
    });
    return params;
}

function parseSinceDate(since: string | undefined): Date | null {
    if (!since) {
        return null;
    }
    const parsed = Date.parse(since);
    return Number.isNaN(parsed) ? null : new Date(parsed);
}

function recordUpdatedAt(record: MutableRecord): number {
    const udate = record.UDATE;
    if (typeof udate !== "string") {
        return 0;
    }
    return Date.parse(udate);
}

function filterSince(
    records: MutableRecord[],
    since: Date | null
): MutableRecord[] {
    if (!since) {
        return records;
    }
    const sinceMs = since.getTime();
    return records.filter((row) => recordUpdatedAt(row) >= sinceMs);
}

function paginate(
    records: MutableRecord[],
    top: number,
    skip: number
): MutableRecord[] {
    return records.slice(skip, skip + top);
}

function handleServiceDocument(res: ServerResponse): void {
    sendJson(res, 200, {
        "@odata.context": `${SERVICE_ROOT_PATH}/$metadata`,
        value: Object.values(PRIORITY_ENTITY_ENDPOINTS).map((entity) => ({
            name: entity.entitySet,
            kind: "EntitySet",
            url: entity.entitySet,
        })),
    });
}

function handleEntityCollection(
    res: ServerResponse,
    importType: PriorityEntityImportType,
    query: Record<string, string>
): void {
    const entity = PRIORITY_ENTITY_ENDPOINTS[importType];
    const top = Math.min(
        Number(query.$top ?? PRIORITY_RATE_LIMITS.recommendedPageSize),
        PRIORITY_RATE_LIMITS.recommendedPageSize
    );
    const skip = Number(query.$skip ?? 0);
    const since = parseSinceDate(query.$since);

    let rows = [...store[importType]];
    if (since) {
        rows = filterSince(rows, since);
    } else if (query.$filter?.includes("UDATE ge")) {
        const match = query.$filter.match(/UDATE ge (.+)$/);
        const filterSinceDate = parseSinceDate(match?.[1]?.trim());
        rows = filterSince(rows, filterSinceDate);
    }

    rows.sort((a, b) => recordUpdatedAt(a) - recordUpdatedAt(b));

    sendJson(res, 200, {
        "@odata.context": `${SERVICE_ROOT_PATH}/$metadata#${entity.entitySet}`,
        value: paginate(rows, top, skip),
    });
}

function handlePatchEntity(
    res: ServerResponse,
    importType: PriorityEntityImportType,
    keySegment: string,
    body: string
): void {
    let patch: MutableRecord;
    try {
        patch = JSON.parse(body) as MutableRecord;
    } catch {
        sendJson(res, 400, {
            error: { code: "400", message: "Invalid JSON body" },
        });
        return;
    }

    const entity = PRIORITY_ENTITY_ENDPOINTS[importType];
    const rows = store[importType];

    const row = rows.find((candidate) => {
        if (entity.erpPrimaryKeyFields.length === 1) {
            const pk = entity.erpPrimaryKeyFields[0];
            const rawKey = decodeURIComponent(keySegment)
                .trim()
                .replace(/^'/, "")
                .replace(/'$/, "");
            return String(candidate[pk]) === rawKey;
        }
        // Composite key: IVNUM='x',IVTYPE='y'
        const keyPairs = keySegment.split(",").map((part) => part.trim());
        return keyPairs.every((pair) => {
            const eq = pair.indexOf("=");
            if (eq < 0) {
                return false;
            }
            const field = pair.slice(0, eq).trim();
            const value = pair
                .slice(eq + 1)
                .trim()
                .replace(/^'/, "")
                .replace(/'$/, "");
            return String(candidate[field]) === value;
        });
    });

    if (!row) {
        sendJson(res, 404, {
            error: { code: "404", message: "Record not found" },
        });
        return;
    }

    Object.assign(row, patch);
    if (!patch.UDATE) {
        row.UDATE = new Date().toISOString();
    }

    sendJson(res, 200, row);
}

function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
    });
}

async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    if (!req.url || !req.method) {
        sendJson(res, 400, { error: { message: "Bad request" } });
        return;
    }

    const url = new URL(req.url, `http://127.0.0.1:${DEFAULT_PORT}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
        sendJson(res, 200, { status: "ok", provider: "PRIORITY_MOCK" });
        return;
    }

    if (!parseBasicAuth(req.headers.authorization)) {
        res.writeHead(401, {
            "WWW-Authenticate": 'Basic realm="Priority OData Mock"',
        });
        res.end();
        return;
    }

    if (req.method === "GET" && pathname === SERVICE_ROOT_PATH) {
        handleServiceDocument(res);
        return;
    }

    const collectionMatch = pathname.match(
        new RegExp(
            `^${SERVICE_ROOT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Z_]+)$`
        )
    );

    if (collectionMatch) {
        const entitySet = collectionMatch[1];
        const importType = ENTITY_SET_TO_IMPORT_TYPE[entitySet];
        if (!importType) {
            sendJson(res, 404, {
                error: { code: "404", message: `Unknown entity set ${entitySet}` },
            });
            return;
        }

        if (req.method === "GET") {
            handleEntityCollection(res, importType, parseQuery(url));
            return;
        }
    }

    const entityKeyMatch = pathname.match(
        new RegExp(
            `^${SERVICE_ROOT_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/([A-Z_]+)\\((.+)\\)$`
        )
    );

    if (entityKeyMatch && req.method === "PATCH") {
        const entitySet = entityKeyMatch[1];
        const keySegment = entityKeyMatch[2];
        const importType = ENTITY_SET_TO_IMPORT_TYPE[entitySet];
        if (!importType) {
            sendJson(res, 404, {
                error: { code: "404", message: `Unknown entity set ${entitySet}` },
            });
            return;
        }
        const body = await readBody(req);
        handlePatchEntity(res, importType, keySegment, body);
        return;
    }

    sendJson(res, 404, {
        error: {
            code: "404",
            message: `No route for ${req.method} ${pathname}`,
        },
    });
}

const server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(res, 500, { error: { code: "500", message } });
    });
});

server.listen(DEFAULT_PORT, "127.0.0.1", () => {
    const base = `http://127.0.0.1:${DEFAULT_PORT}${SERVICE_ROOT_PATH}`;
    process.stdout.write(
        [
            "Priority OData mock server running",
            `  Service root: ${base}`,
            "  Auth: Basic (any non-empty username + password)",
            "  Health: GET /health",
            "",
            "Example:",
            `  curl -u token:PAT "${base}/CUSTOMERS?$top=2"`,
            "",
            "Overlap test (bump customer UDATE):",
            `  curl -u token:PAT -X PATCH "${base}/CUSTOMERS('T000001')"`,
            '    -H "Content-Type: application/json"',
            '    -d \'{"CDES":"Acme Trading Ltd (updated)"}\'',
            `  curl -u token:PAT "${base}/CUSTOMERS?$since=2025-06-01T07:00:00Z"`,
            "",
        ].join("\n")
    );
});
