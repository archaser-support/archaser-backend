import type { INestApplication } from "@nestjs/common";
/**
 * Browser CORS for public Nest apps (api, sms, connectors, reports).
 * Origins come from the UI host (`NEXT_PUBLIC_BASE_URL`) and any extra
 * `NEST_CORS_ORIGINS` (comma-separated), matching the main API.
 */
export declare function parseCorsOrigins(...values: Array<string | undefined | null>): string[] | true;
export declare const PUBLIC_CORS_ALLOWED_HEADERS: readonly ["Authorization", "Content-Type", "Cookie"];
export declare function enablePublicCors(app: INestApplication, env?: NodeJS.ProcessEnv): void;
