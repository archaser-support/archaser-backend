import { test, expect } from "@playwright/test";

const nestBase =
    process.env.E2E_NEST_URL ||
    process.env.NEXT_PUBLIC_NEST_API_BASE_URL ||
    "http://localhost:3002";

test.describe("staging smoke @smoke", () => {
    test("Nest health is up", async ({ request }) => {
        const res = await request.get(`${nestBase}/health`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.status).toBe("ok");
    });
});
