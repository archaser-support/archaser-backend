import {
    parseCorsOrigins,
    PUBLIC_CORS_ALLOWED_HEADERS,
} from "@archaser/auth";

describe("parseCorsOrigins", () => {
    it("lists the Amplify UI host and extra origins for the API host", () => {
        expect(
            parseCorsOrigins(
                "https://staging.archaser.com",
                "https://staging.d2nb6pdzevzjzz.amplifyapp.com"
            )
        ).toEqual([
            "https://staging.archaser.com",
            "https://staging.d2nb6pdzevzjzz.amplifyapp.com",
        ]);
    });

    it("splits comma-separated NEST_CORS_ORIGINS", () => {
        expect(
            parseCorsOrigins(
                undefined,
                "https://staging.archaser.com, https://staging.d2nb6pdzevzjzz.amplifyapp.com"
            )
        ).toEqual([
            "https://staging.archaser.com",
            "https://staging.d2nb6pdzevzjzz.amplifyapp.com",
        ]);
    });

    it("allows any origin when nothing is configured (local default)", () => {
        expect(parseCorsOrigins(undefined, undefined)).toBe(true);
    });

    it("strips trailing slashes so Amplify Origin matches", () => {
        expect(
            parseCorsOrigins(
                "https://staging.archaser.com/",
                "https://staging.d2nb6pdzevzjzz.amplifyapp.com/"
            )
        ).toEqual([
            "https://staging.archaser.com",
            "https://staging.d2nb6pdzevzjzz.amplifyapp.com",
        ]);
    });

    it("keeps Authorization for Amplify Bearer preflight", () => {
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("Authorization");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("X-CSRF-Token");
    });
});
