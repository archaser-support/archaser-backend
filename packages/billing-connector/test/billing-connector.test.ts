import {
    assertPriorityProvider,
    encryptCredentials,
    decryptCredentials,
} from "../src/index";

describe("@archaser/billing-connector", () => {
    describe("assertPriorityProvider", () => {
        it("should not throw for PRIORITY provider", () => {
            expect(() => assertPriorityProvider("PRIORITY")).not.toThrow();
        });

        it("should throw for non-PRIORITY providers", () => {
            expect(() => assertPriorityProvider("QUICKBOOKS")).toThrow(
                "Only PRIORITY provider is supported"
            );
            expect(() => assertPriorityProvider("SAP")).toThrow(
                "Only PRIORITY provider is supported"
            );
        });
    });

    describe("crypto roundtrip", () => {
        beforeAll(() => {
            // Set encryption key for tests
            process.env.BILLING_CONNECTOR_ENCRYPTION_KEY =
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        });

        it("should encrypt and decrypt credentials", () => {
            const original = {
                token: "test-api-key-12345",
                username: "testuser",
            };

            const encrypted = encryptCredentials(original);
            expect(encrypted).toBeTruthy();
            expect(typeof encrypted).toBe("string");

            const decrypted = decryptCredentials(encrypted);
            expect(decrypted).toEqual(original);
        });

        it("should produce different ciphertext for same plaintext", () => {
            const credentials = { token: "same-token" };
            const encrypted1 = encryptCredentials(credentials);
            const encrypted2 = encryptCredentials(credentials);

            expect(encrypted1).not.toBe(encrypted2);

            const decrypted1 = decryptCredentials(encrypted1);
            const decrypted2 = decryptCredentials(encrypted2);
            expect(decrypted1).toEqual(credentials);
            expect(decrypted2).toEqual(credentials);
        });
    });

    describe("testBillingConnectorConnection missing creds", () => {
        it("should fail gracefully when credentials are invalid", async () => {
            const { testBillingConnectorConnection } = await import("../src/index");

            const result = await testBillingConnectorConnection({
                provider: "PRIORITY",
                authType: "API_KEY",
                baseUrl: "https://invalid.example.com",
                credentials: {},
            });

            expect(result.ok).toBe(false);
            expect(result.error).toMatch(/token is required/i);
        });
    });
});
