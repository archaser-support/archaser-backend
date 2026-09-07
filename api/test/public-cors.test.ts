import {
    parseCorsOrigins,
    isAllowedOrigin,
    PUBLIC_CORS_ALLOWED_HEADERS,
} from "@archaser/auth";

describe("parseCorsOrigins and isAllowedOrigin", () => {
    it("lists origins with http/https and www auto-expansion", () => {
        const origins = parseCorsOrigins(
            "https://staging.archaser.com",
            "https://staging.d2nb6pdzevzjzz.amplifyapp.com"
        );
        expect(origins).toContain("https://staging.archaser.com");
        expect(origins).toContain("http://staging.archaser.com");
        expect(origins).toContain("https://www.staging.archaser.com");
        expect(origins).toContain("https://staging.d2nb6pdzevzjzz.amplifyapp.com");
    });

    it("allows archaser.com subdomains and amplifyapp.com origins dynamically", () => {
        const allowed = parseCorsOrigins("https://staging.archaser.com");
        expect(isAllowedOrigin("https://production.archaser.com", allowed)).toBe(true);
        expect(isAllowedOrigin("https://portal.archaser.com", allowed)).toBe(true);
        expect(isAllowedOrigin("https://main.d2nb6pdzevzjzz.amplifyapp.com", allowed)).toBe(true);
        expect(isAllowedOrigin("http://localhost:3000", allowed)).toBe(true);
        expect(isAllowedOrigin("https://malicious.com", allowed)).toBe(false);
    });

    it("allows any origin when nothing is configured (local default)", () => {
        expect(parseCorsOrigins(undefined, undefined)).toBe(true);
        expect(isAllowedOrigin("http://localhost:3000", true)).toBe(true);
    });

    it("keeps Authorization, Cache-Control, X-CID and other standard/custom headers", () => {
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("Authorization");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("X-CSRF-Token");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("Cache-Control");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("Pragma");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("X-CID");
        expect(PUBLIC_CORS_ALLOWED_HEADERS).toContain("Sentry-Trace");
    });
});
