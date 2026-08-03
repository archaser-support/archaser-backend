/**
 * Typed Nest OpenAPI client for Amplify / archaser-web (Stage 1b).
 * Generate fuller types later:
 *   npm run openapi:export && npx openapi-typescript ./api/openapi.json -o ./packages/openapi-client/src/schema.ts
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
        if (!headers.has("Content-Type") && init.body) {
            headers.set("Content-Type", "application/json");
        }
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
        if (res.status === 204) {
            return undefined as T;
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
            }>("/api/auth/me"),
        runCronNow: (jobId: number) =>
            request<{ queued?: boolean; jobId?: string }>(
                `/api/gateway/cron/${jobId}/run-now`,
                { method: "POST", body: "{}" }
            ),
        listCustomers: (query = "") =>
            request<unknown>(`/api/customers${query ? `?${query}` : ""}`),
        getCustomer: (id: number) =>
            request<unknown>(`/api/customers/${id}`),
        listInvoices: (query = "") =>
            request<unknown>(`/api/invoices${query ? `?${query}` : ""}`),
        billingConnector: {
            get: (accountId: number) =>
                request<unknown>(
                    `/api/entities/accounts/${accountId}/billing-connector`
                ),
            sync: (accountId: number, body: Record<string, unknown> = {}) =>
                request<unknown>(
                    `/api/entities/accounts/${accountId}/billing-connector/sync`,
                    { method: "POST", body: JSON.stringify(body) }
                ),
            test: (accountId: number) =>
                request<unknown>(
                    `/api/entities/accounts/${accountId}/billing-connector/test`,
                    { method: "POST", body: "{}" }
                ),
        },
        reports: {
            list: () => request<unknown>("/api/reports"),
            execute: (id: number, body: Record<string, unknown>) =>
                request<unknown>(`/api/reports/${id}/execute`, {
                    method: "POST",
                    body: JSON.stringify(body),
                }),
        },
        request,
    };
}

export type NestClient = ReturnType<typeof createNestClient>;
