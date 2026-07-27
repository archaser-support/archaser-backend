import { PrismaClient } from "@prisma/client";

/**
 * @archaser/database — shared Postgres access for Nest (and later worker/services).
 *
 * Schema / migrations ownership (Stage 0 path):
 * - Source of truth today: `backend/prisma/schema.prisma` + `backend/prisma/migrations/`.
 * - Next.js continues to generate `@prisma/client` from that tree.
 * - This package is the Nest consumption seam: create a labeled PrismaClient against
 *   the same `DATABASE_URL` / Postgres instance.
 * - At repo extract (Stage 1B), move schema + migrations into this package and publish
 *   privately; Nest/Next/worker will depend on the versioned package instead of
 *   importing Prisma from the Next app tree.
 *
 * Rule for Amplify/UI prep: web UI must not import this package or `@prisma/client`.
 */

export { PrismaClient };
export type { Prisma } from "@prisma/client";

export type DatabaseModuleName =
    | "api"
    | "worker"
    | "web"
    | "jobs"
    | "cron"
    | "sms"
    | "connectors"
    | "reports";

export interface CreatePrismaClientOptions {
    module?: DatabaseModuleName;
    applicationName?: string;
    connectionLimit?: number;
}

/**
 * Resolve DATABASE_URL for a Nest/worker process against shared Postgres.
 */
export function resolveDatabaseUrl(
    options: CreatePrismaClientOptions = {}
): string {
    const moduleName = options.module ?? "api";
    const envKey = `DATABASE_URL_${moduleName.toUpperCase()}`;
    const databaseUrl =
        process.env[envKey] || process.env.DATABASE_URL || "";

    if (!databaseUrl) {
        return databaseUrl;
    }

    try {
        const url = new URL(databaseUrl);
        const applicationName =
            options.applicationName ?? `archaser-${moduleName}`;
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
        url.searchParams.set(
            "options",
            existingOptions
                ? `${existingOptions} ${timezoneOption}`
                : timezoneOption
        );

        return url.toString();
    } catch {
        return databaseUrl;
    }
}

/**
 * Create a PrismaClient pointed at the shared Archaser Postgres.
 */
export function createPrismaClient(
    options: CreatePrismaClientOptions = {}
): PrismaClient {
    return new PrismaClient({
        log: ["error"],
        errorFormat: "pretty",
        datasources: {
            db: {
                url: resolveDatabaseUrl(options),
            },
        },
    });
}
