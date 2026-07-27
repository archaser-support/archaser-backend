"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaClient = void 0;
exports.resolveDatabaseUrl = resolveDatabaseUrl;
exports.createPrismaClient = createPrismaClient;
const client_1 = require("@prisma/client");
Object.defineProperty(exports, "PrismaClient", { enumerable: true, get: function () { return client_1.PrismaClient; } });
/**
 * Resolve DATABASE_URL for a Nest/worker process against shared Postgres.
 */
function resolveDatabaseUrl(options = {}) {
    const moduleName = options.module ?? "api";
    const envKey = `DATABASE_URL_${moduleName.toUpperCase()}`;
    const databaseUrl = process.env[envKey] || process.env.DATABASE_URL || "";
    if (!databaseUrl) {
        return databaseUrl;
    }
    try {
        const url = new URL(databaseUrl);
        const applicationName = options.applicationName ?? `archaser-${moduleName}`;
        const connectionLimit = options.connectionLimit ?? 10;
        url.searchParams.set("application_name", applicationName);
        url.searchParams.set("connection_limit", String(connectionLimit));
        if (!url.searchParams.has("pool_timeout")) {
            url.searchParams.set("pool_timeout", "20");
        }
        if (!url.searchParams.has("connect_timeout")) {
            url.searchParams.set("connect_timeout", "10");
        }
        const existingOptions = url.searchParams.get("options") || "";
        const timezoneOption = "-c timezone=UTC";
        url.searchParams.set("options", existingOptions
            ? `${existingOptions} ${timezoneOption}`
            : timezoneOption);
        return url.toString();
    }
    catch {
        return databaseUrl;
    }
}
/**
 * Create a PrismaClient pointed at the shared Archaser Postgres.
 */
function createPrismaClient(options = {}) {
    return new client_1.PrismaClient({
        log: ["error"],
        errorFormat: "pretty",
        datasources: {
            db: {
                url: resolveDatabaseUrl(options),
            },
        },
    });
}
