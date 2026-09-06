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
export function parseCorsOrigins(
    ...values: Array<string | undefined | null>
): string[] | true {
    const origins = values
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(","))
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
    // De-dupe while preserving order
    return origins.length > 0 ? [...new Set(origins)] : true;
}

export const PUBLIC_CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Cookie",
    "Accept",
    "X-CSRF-Token",
    "X-Requested-With",
] as const;

export function enablePublicCors(
    app: INestApplication,
    env: NodeJS.ProcessEnv = process.env
): void {
    const origin = parseCorsOrigins(
        env.NEXT_PUBLIC_BASE_URL,
        env.NEST_CORS_ORIGINS
    );
    app.enableCors({
        origin,
        credentials: true,
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: [...PUBLIC_CORS_ALLOWED_HEADERS],
    });
}
