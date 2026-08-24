import { generateTrackingPixelUrl } from "../src/email/emailTrackingUtils";
import { resolvePublicApiOrigin } from "../src/publicApiUrl";
import { processTemplateContent } from "../src/templates/processTemplateContent";
import { getCustomerPortalUrl } from "../src/templates/getCustomerPortalUrl";

const ENV_KEYS = [
    "NEST_PUBLIC_URL",
    "NEXT_PUBLIC_NEST_API_BASE_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXTAUTH_URL",
    "NODE_ENV",
] as const;

describe("public API host URLs in emails", () => {
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of ENV_KEYS) {
            originalEnv[key] = process.env[key];
        }
    });

    afterEach(() => {
        for (const key of ENV_KEYS) {
            const value = originalEnv[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it("prefers NEST_PUBLIC_URL over the Amplify UI host for pixels", () => {
        process.env.NEST_PUBLIC_URL = "https://api.staging.archaser.com";
        process.env.NEXT_PUBLIC_NEST_API_BASE_URL =
            "https://api.staging.archaser.com";
        process.env.NEXT_PUBLIC_BASE_URL = "https://staging.archaser.com";
        process.env.NEXTAUTH_URL = "https://staging.archaser.com";

        expect(resolvePublicApiOrigin()).toBe(
            "https://api.staging.archaser.com"
        );
        expect(generateTrackingPixelUrl("msg-1")).toBe(
            "https://api.staging.archaser.com/api/email/track-open?messageId=msg-1"
        );
    });

    it("puts account logos on the API host", () => {
        process.env.NEST_PUBLIC_URL = "https://api.staging.archaser.com";
        process.env.NEXT_PUBLIC_BASE_URL = "https://staging.archaser.com";
        process.env.NEXTAUTH_URL = "https://staging.archaser.com";

        const html = processTemplateContent({
            content: "{customer_logo}",
            account: {
                id: 9,
                name: "Acme",
                logo: "s3://logo",
                sub_domain: null,
            },
            customer: {
                type: "Company",
                customer_uuid: "cust-1",
                Company: { name: "Acme" },
            },
            contact: { first_name: "Pat", id: 1 },
        });

        expect(html).toContain(
            "https://api.staging.archaser.com/api/accounts/9/logo"
        );
        expect(html).not.toContain("https://staging.archaser.com/api/accounts");
    });

    it("keeps portal links on the UI host", () => {
        process.env.NEXT_PUBLIC_BASE_URL = "https://staging.archaser.com";
        process.env.NEST_PUBLIC_URL = "https://api.staging.archaser.com";
        process.env.NODE_ENV = "production";

        expect(getCustomerPortalUrl("cust-1")).toBe(
            "https://staging.archaser.com/en/portal/cust-1"
        );
    });
});
