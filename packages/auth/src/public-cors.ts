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
    if (origins.length === 0) {
        return true;
    }
    const set = new Set<string>();
    for (const item of origins) {
        try {
            const url = new URL(item);
            set.add(`${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`);
            const otherProtocol = url.protocol === "https:" ? "http:" : "https:";
            set.add(`${otherProtocol}//${url.hostname}${url.port ? `:${url.port}` : ""}`);

            if (url.hostname.startsWith("www.")) {
                const nonWww = url.hostname.slice(4);
                set.add(`${url.protocol}//${nonWww}${url.port ? `:${url.port}` : ""}`);
                set.add(`${otherProtocol}//${nonWww}${url.port ? `:${url.port}` : ""}`);
            } else if (
                !url.hostname.includes("localhost") &&
                !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
            ) {
                const www = `www.${url.hostname}`;
                set.add(`${url.protocol}//${www}${url.port ? `:${url.port}` : ""}`);
                set.add(`${otherProtocol}//${www}${url.port ? `:${url.port}` : ""}`);
            }
        } catch {
            set.add(item);
        }
    }
    return [...set];
}

export function isAllowedOrigin(
    origin: string | undefined | null,
    allowedOrigins: string[] | true
): boolean {
    if (!origin || allowedOrigins === true) {
        return true;
    }
    const normalized = origin.trim().replace(/\/$/, "");
    if (allowedOrigins.includes(normalized)) {
        return true;
    }
    try {
        const url = new URL(normalized);
        const hostname = url.hostname.toLowerCase();

        if (hostname === "localhost" || hostname === "127.0.0.1") {
            return true;
        }
        if (hostname === "archaser.com" || hostname.endsWith(".archaser.com")) {
            return true;
        }
        if (hostname.endsWith(".amplifyapp.com")) {
            return true;
        }
    } catch {
        // Return false on invalid URL
    }
    return false;
}

export const PUBLIC_CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Cookie",
    "Accept",
    "X-CSRF-Token",
    "X-Requested-With",
    "Cache-Control",
    "Pragma",
    "Expires",
    "If-Modified-Since",
    "If-None-Match",
    "X-CID",
    "X-Pathname",
    "X-Search",
    "X-I18n-Skip",
    "X-Request-Id",
    "Sentry-Trace",
    "Baggage",
    "X-Amz-Date",
    "X-Api-Key",
    "X-Amz-Security-Token",
] as const;

export function enablePublicCors(
    app: INestApplication,
    env: NodeJS.ProcessEnv = process.env
): void {
    const allowedOrigins = parseCorsOrigins(
        env.NEXT_PUBLIC_BASE_URL,
        env.NEST_CORS_ORIGINS
    );
    app.enableCors({
        origin: (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
            if (isAllowedOrigin(requestOrigin, allowedOrigins)) {
                callback(null, true);
            } else {
                callback(null, false);
            }
        },
        credentials: true,
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: [...PUBLIC_CORS_ALLOWED_HEADERS],
        exposedHeaders: [
            "Content-Disposition",
            "X-Total-Count",
            "X-CSRF-Token",
            "Authorization",
            "X-Pathname",
            "X-CID",
        ],
        optionsSuccessStatus: 204,
    });
}
