"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PUBLIC_CORS_ALLOWED_HEADERS = void 0;
exports.parseCorsOrigins = parseCorsOrigins;
exports.enablePublicCors = enablePublicCors;
/**
 * Browser CORS for public Nest apps (api, sms, connectors, reports).
 * Origins come from the UI host (`NEXT_PUBLIC_BASE_URL`) and any extra
 * `NEST_CORS_ORIGINS` (comma-separated), matching the main API.
 */
function parseCorsOrigins(...values) {
    const origins = values
        .filter((value) => Boolean(value))
        .flatMap((value) => value.split(","))
        .map((origin) => origin.trim())
        .filter(Boolean);
    return origins.length > 0 ? origins : true;
}
exports.PUBLIC_CORS_ALLOWED_HEADERS = [
    "Authorization",
    "Content-Type",
    "Cookie",
];
function enablePublicCors(app, env = process.env) {
    app.enableCors({
        origin: parseCorsOrigins(env.NEXT_PUBLIC_BASE_URL, env.NEST_CORS_ORIGINS),
        credentials: true,
        allowedHeaders: [...exports.PUBLIC_CORS_ALLOWED_HEADERS],
    });
}
