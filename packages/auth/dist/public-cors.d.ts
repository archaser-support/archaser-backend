import type { INestApplication } from "@nestjs/common";
/**
 * Browser CORS for public Nest apps (api, sms, connectors, reports).
 * Origins come from the UI host (`NEXT_PUBLIC_BASE_URL`) and any extra
 * `NEST_CORS_ORIGINS` (comma-separated), matching the main API.
 *
 * Amplify UI (staging.archaser.com) calls api.staging.archaser.com cross-origin
 * with Bearer tokens — origins must match the browser Origin header exactly
 * (no trailing slash).
 */
export declare function parseCorsOrigins(...values: Array<string | undefined | null>): string[] | true;
export declare const PUBLIC_CORS_ALLOWED_HEADERS: readonly ["Authorization", "Content-Type", "Cookie", "Accept", "X-CSRF-Token", "X-Requested-With"];
export declare function enablePublicCors(app: INestApplication, env?: NodeJS.ProcessEnv): void;
