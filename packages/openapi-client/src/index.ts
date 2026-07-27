/**
 * Typed Nest OpenAPI client stub for Amplify / archaser-web.
 * Generate full client: npm run openapi:export && npx openapi-typescript backend/api/openapi.json -o backend/packages/openapi-client/src/schema.ts
 *
 * Web must call Nest with Authorization: Bearer only — never import Prisma.
 */
export type NestTokenStorage = {
    getAccessToken: () => string | null;
};

export function createNestClient(options: {
    baseUrl: string;
    tokens: NestTokenStorage;
}) {
    const { baseUrl, tokens } = options;

    async function request<T>(
        path: string,
        init: RequestInit = {}
    ): Promise<T> {
        const token = tokens.getAccessToken();
        const headers = new Headers(init.headers || {});
        headers.set("Content-Type", "application/json");
        if (token) {
            headers.set("Authorization", `Bearer ${token}`);
        }
        const res = await fetch(
            `${baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`,
            { ...init, headers }
        );
        if (!res.ok) {
            throw new Error(`Nest ${res.status}: ${await res.text()}`);
        }
        return res.json() as Promise<T>;
    }

    return {
        health: () => request<{ status: string }>("/health"),
        me: () =>
            request<{
                sub: string;
                account_id?: number | null;
                role?: string | null;
            }>("/auth/me"),
        runCronNow: (jobId: number) =>
            request<{ queued: boolean; jobId?: string }>(
                `/api/gateway/cron/${jobId}/run-now`,
                { method: "POST", body: "{}" }
            ),
        request,
    };
}

export type NestClient = ReturnType<typeof createNestClient>;
