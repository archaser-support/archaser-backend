import { createHmac } from "crypto";
import {
    buildWebhookUrl,
    sendViaInforu,
    sendViaMessageBird,
    sendViaTwilio,
    sendViaVendor,
    validateTwilioWebhookSignature,
} from "../src";

describe("validateTwilioWebhookSignature", () => {
    const authToken = "test-auth-token";
    const url = "https://staging.archaser.com/api/sms/webhook/twilio";
    const body = {
        MessageSid: "SM123",
        MessageStatus: "delivered",
    };

    function sign(
        token: string,
        fullUrl: string,
        params: Record<string, string>
    ) {
        const bodyString = new URLSearchParams(params).toString();
        return createHmac("sha1", token)
            .update(fullUrl + bodyString)
            .digest("base64");
    }

    it("accepts a valid signature", () => {
        expect(
            validateTwilioWebhookSignature({
                authToken,
                signature: sign(authToken, url, body),
                url,
                body,
            })
        ).toBe(true);
    });

    it("rejects a bad signature", () => {
        expect(
            validateTwilioWebhookSignature({
                authToken,
                signature: "bad",
                url,
                body,
            })
        ).toBe(false);
    });

    it("skips when auth token missing", () => {
        expect(
            validateTwilioWebhookSignature({
                authToken: undefined,
                signature: undefined,
                url,
                body,
            })
        ).toBe(true);
    });

    it("buildWebhookUrl uses forwarded proto + host", () => {
        expect(
            buildWebhookUrl({
                headers: {
                    "x-forwarded-proto": "https",
                    host: "app.example.com",
                },
                originalUrl: "/api/sms/webhook/twilio",
            })
        ).toBe("https://app.example.com/api/sms/webhook/twilio");
    });
});

describe("sendViaTwilio", () => {
    it("creates a message with statusCallback when webhook_url set", async () => {
        const create = jest.fn().mockResolvedValue({ sid: "SM999" });
        const factory = jest.fn().mockReturnValue({ messages: { create } });

        const result = await sendViaTwilio(
            {
                id: 7,
                account_sid: "ACxxx",
                auth_token: "token",
                webhook_url: "https://app/api/sms/webhook/twilio",
                phone_number: "+15551212",
                cost_per_sms: 0.05,
            },
            "+15550001111",
            "fallback",
            "hello",
            factory
        );

        expect(result).toEqual({
            success: true,
            messageId: "SM999",
            cost: 0.05,
            segments: 1,
            vendorId: 7,
        });
        expect(create).toHaveBeenCalledWith({
            body: "hello",
            from: "+15551212",
            to: "+15550001111",
            statusCallback: "https://app/api/sms/webhook/twilio",
        });
    });

    it("fails when credentials missing", async () => {
        const result = await sendViaTwilio(
            { id: 1, account_sid: null, auth_token: null },
            "+1",
            "+2",
            "x"
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/missing account_sid/);
    });
});

describe("sendViaInforu", () => {
    it("fails when api_secret/auth_token missing (D56 — no hardcoded secret)", async () => {
        const result = await sendViaInforu(
            { id: 3, api_key: "key", api_secret: null, auth_token: null },
            "+972501234567",
            "Sender",
            "hi"
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/api_secret\/auth_token/);
    });

    it("posts Basic auth from DB credentials and returns customer message id", async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            json: async () => ({
                StatusId: 1,
                MessageID: "vendor-99",
            }),
        });

        const result = await sendViaInforu(
            {
                id: 3,
                api_key: "key",
                api_secret: "secret-from-db",
                cost_per_sms: 0.1,
            },
            "+972501234567",
            "Sender",
            "hello",
            {
                fetchImpl: fetchImpl as unknown as typeof fetch,
                webhookBaseUrl: "https://app.example.com",
            }
        );

        expect(result.success).toBe(true);
        expect(result.vendorMessageId).toBe("vendor-99");
        expect(result.messageId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
        expect(fetchImpl).toHaveBeenCalledWith(
            "https://capi.inforu.co.il/api/v2/SMS/SendSms",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    Authorization: `Basic ${Buffer.from("key:secret-from-db").toString("base64")}`,
                }),
            })
        );
        const body = JSON.parse(
            (fetchImpl.mock.calls[0][1] as { body: string }).body
        );
        expect(body.Data.Settings.DeliveryNotificationUrl).toBe(
            "https://app.example.com/api/sms/webhook/inforu"
        );
    });

    it("falls back to auth_token when api_secret empty", async () => {
        const fetchImpl = jest.fn().mockResolvedValue({
            json: async () => ({ StatusId: 1, MessageId: "v1" }),
        });
        await sendViaInforu(
            {
                id: 3,
                api_key: "key",
                api_secret: null,
                auth_token: "token-as-secret",
            },
            "+1",
            "S",
            "x",
            { fetchImpl: fetchImpl as unknown as typeof fetch }
        );
        const auth = (fetchImpl.mock.calls[0][1] as { headers: Record<string, string> })
            .headers.Authorization;
        expect(auth).toBe(
            `Basic ${Buffer.from("key:token-as-secret").toString("base64")}`
        );
    });
});

describe("sendViaMessageBird", () => {
    it("fails without api_key", async () => {
        const result = await sendViaMessageBird(
            { id: 2, api_key: null },
            "+1",
            "from",
            "hi"
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/missing api_key/);
    });

    it("creates via injected client factory", async () => {
        const create = jest
            .fn()
            .mockResolvedValue({ id: "mb-1", mtCount: 2 });
        const factory = jest.fn().mockReturnValue({ messages: { create } });
        const result = await sendViaMessageBird(
            { id: 2, api_key: "mb-key", cost_per_sms: 0.02 },
            "+1555",
            "ORIG",
            "body",
            factory
        );
        expect(result).toEqual({
            success: true,
            messageId: "mb-1",
            cost: 0.02,
            segments: 2,
            vendorId: 2,
        });
        expect(create).toHaveBeenCalledWith({
            originator: "ORIG",
            recipients: ["+1555"],
            body: "body",
        });
    });
});

describe("sendViaVendor", () => {
    it("routes by provider", async () => {
        const create = jest.fn().mockResolvedValue({ sid: "SM1" });
        const result = await sendViaVendor(
            {
                id: 1,
                provider: "twilio",
                account_sid: "AC",
                auth_token: "t",
                phone_number: "+100",
            },
            "+200",
            "fallback",
            "hi",
            {
                twilioClientFactory: () => ({
                    messages: { create },
                }),
            }
        );
        expect(result.success).toBe(true);
        expect(result.messageId).toBe("SM1");
    });

    it("returns error for unknown provider", async () => {
        const result = await sendViaVendor(
            { id: 9, provider: "other" },
            "+1",
            "f",
            "b"
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/Unsupported/);
    });
});
