"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_CORS_ALLOWED_HEADERS = void 0;
exports.parseCorsOrigins = parseCorsOrigins;
exports.enablePublicCors = enablePublicCors;
/**
 * Browser CORS for public Nest apps (api, sms, connectors, reports).
 * Origins come from the UI host (`NEXT_PUBLIC_BASE_URL`) and any extra
 * `NEST_CORS_ORIGINS` (comma-separated), matching the main API.
 *
 * Amplify UI (staging.archaser.com) calls api.staging.archaser.com cross-origin
 * with Bearer tokens — origins must match the browser Origin header exactly
 * (no trailing slash).
 */
function parseCorsOrigins(...values) {
    const origins = values
        .filter((value) => Boolean(value))
        .flatMap((value) => value.split(","))
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean);
    // De-dupe while preserving order
    return origins.length > 0 ? [...new Set(origins)] : true;
}
exports.PUBLIC_CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Cookie",
    "Accept",
    "X-CSRF-Token",
    "X-Requested-With",
];
function enablePublicCors(app, env = process.env) {
    const origin = parseCorsOrigins(env.NEXT_PUBLIC_BASE_URL, env.NEST_CORS_ORIGINS);
    app.enableCors({
        origin,
        credentials: true,
        methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
        allowedHeaders: [...exports.PUBLIC_CORS_ALLOWED_HEADERS],
    });
}
