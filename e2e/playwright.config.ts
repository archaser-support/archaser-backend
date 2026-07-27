import { defineConfig, devices } from "@playwright/test";

/**
 * Point at staging Amplify + Nest. Do not bundle this package into Amplify or Nest prod builds.
 */
export default defineConfig({
    testDir: "./tests",
    timeout: 120_000,
    use: {
        baseURL:
            process.env.E2E_AMPLIFY_URL ||
            process.env.NEXT_PUBLIC_BASE_URL ||
            "http://localhost:3000",
        extraHTTPHeaders: {
            // Nest API base for smoke helpers
        },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
