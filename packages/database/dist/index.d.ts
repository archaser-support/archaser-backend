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
export type DatabaseModuleName = "api" | "worker" | "web" | "jobs" | "cron" | "sms" | "connectors" | "reports";
export interface CreatePrismaClientOptions {
    module?: DatabaseModuleName;
    applicationName?: string;
    connectionLimit?: number;
}
/**
 * Resolve DATABASE_URL for a Nest/worker process against shared Postgres.
 */
export declare function resolveDatabaseUrl(options?: CreatePrismaClientOptions): string;
/**
 * Create a PrismaClient pointed at the shared Archaser Postgres.
 */
export declare function createPrismaClient(options?: CreatePrismaClientOptions): PrismaClient;
