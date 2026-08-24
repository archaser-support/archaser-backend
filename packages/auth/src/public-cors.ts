import type { INestApplication } from "@nestjs/common";

/**
 * Browser CORS for public Nest apps (api, sms, connectors, reports).
 * Origins come from the UI host (`NEXT_PUBLIC_BASE_URL`) and any extra
 * `NEST_CORS_ORIGINS` (comma-separated), matching the main API.
 */
export function parseCorsOrigins(
    ...values: Array<string | undefined | null>
): string[] | true {
    const origins = values
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.split(","))
        .map((origin) => origin.trim())
        .filter(Boolean);
    return origins.length > 0 ? origins : true;
}

export const PUBLIC_CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Cookie",
] as const;

export function enablePublicCors(
    app: INestApplication,
    env: NodeJS.ProcessEnv = process.env
): void {
    app.enableCors({
        origin: parseCorsOrigins(
            env.NEXT_PUBLIC_BASE_URL,
            env.NEST_CORS_ORIGINS
        ),
        credentials: true,
        allowedHeaders: [...PUBLIC_CORS_ALLOWED_HEADERS],
    });
}
