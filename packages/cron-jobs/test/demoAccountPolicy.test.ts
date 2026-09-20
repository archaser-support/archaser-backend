import {
    accountAllowsCustomerOutreach,
    accountAllowsImportCatalog,
    isStagingDeploy,
} from "../src/demoAccountPolicy";

describe("demoAccountPolicy", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    function setEnv( partial: Record<string, string | undefined>) {
        process.env = { ...originalEnv };
        for (const [k, v] of Object.entries(partial)) {
            if (v === undefined) {
                delete process.env[k];
            } else {
                process.env[k] = v;
            }
        }
    }

    it("treats local development like staging and gates on is_demo", () => {
        setEnv({
            NODE_ENV: "development",
            SERVICE_NAME: undefined,
            NEST_PUBLIC_URL: undefined,
            NEXTAUTH_URL: "http://localhost:3000",
            NEXT_PUBLIC_BASE_URL: undefined,
            PORT: undefined,
        });
        expect(isStagingDeploy()).toBe(true);
        expect(accountAllowsCustomerOutreach(false)).toBe(false);
        expect(accountAllowsCustomerOutreach(true)).toBe(true);
        expect(accountAllowsImportCatalog(false)).toBe(false);
        expect(accountAllowsImportCatalog(true)).toBe(true);
    });

    it("treats localhost URLs as Demo-gated even when NODE_ENV=production", () => {
        setEnv({
            NODE_ENV: "production",
            SERVICE_NAME: "archaser-core",
            NEST_PUBLIC_URL: undefined,
            NEXTAUTH_URL: "http://localhost:3000",
            NEXT_PUBLIC_BASE_URL: undefined,
            PORT: "3002",
        });
        expect(isStagingDeploy()).toBe(true);
        expect(accountAllowsCustomerOutreach(false)).toBe(false);
        expect(accountAllowsImportCatalog(true)).toBe(true);
    });

    it("treats api.staging host as staging and gates on is_demo", () => {
        setEnv({
            NODE_ENV: "production",
            SERVICE_NAME: "archaser-api-staging",
            NEST_PUBLIC_URL: "https://api.staging.archaser.com",
            NEXTAUTH_URL: "https://staging.archaser.com",
            PORT: "3000",
        });
        expect(isStagingDeploy()).toBe(true);
        expect(accountAllowsCustomerOutreach(false)).toBe(false);
        expect(accountAllowsCustomerOutreach(true)).toBe(true);
        expect(accountAllowsImportCatalog(false)).toBe(false);
        expect(accountAllowsImportCatalog(true)).toBe(true);
    });

    it("treats production as not staging", () => {
        setEnv({
            NODE_ENV: "production",
            SERVICE_NAME: "archaser-api-production",
            NEST_PUBLIC_URL: "https://api.portal.archaser.com",
            NEXTAUTH_URL: "https://archaser.com",
            PORT: "3000",
        });
        expect(isStagingDeploy()).toBe(false);
        expect(accountAllowsCustomerOutreach(false)).toBe(true);
        expect(accountAllowsImportCatalog(true)).toBe(false);
    });
});
