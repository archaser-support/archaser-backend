"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePublicApiOrigin = resolvePublicApiOrigin;
/**
 * Public Nest origin for assets that must hit `/api` (tracking pixels, logos).
 * Prefer `NEST_PUBLIC_URL` / `NEXT_PUBLIC_NEST_API_BASE_URL` over the UI host
 * so Amplify at staging.archaser.com does not receive `/api` pixel requests.
 */
function resolvePublicApiOrigin(explicit) {
    const candidates = [
        explicit,
        process.env.NEST_PUBLIC_URL,
        process.env.NEXT_PUBLIC_NEST_API_BASE_URL,
        process.env.NEXT_PUBLIC_BASE_URL,
        process.env.NEXTAUTH_URL,
    ];
    for (const value of candidates) {
        const trimmed = value?.trim();
        if (trimmed) {
            return trimmed.replace(/\/$/, "");
        }
    }
    return "https://archaser.com";
}
