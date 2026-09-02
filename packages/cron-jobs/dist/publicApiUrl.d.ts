/**
 * Public Nest origin for assets that must hit `/api` (tracking pixels, logos).
 * Prefer `NEST_PUBLIC_URL` / `NEXT_PUBLIC_NEST_API_BASE_URL` over the UI host
 * so Amplify at staging.archaser.com does not receive `/api` pixel requests.
 */
export declare function resolvePublicApiOrigin(explicit?: string): string;
