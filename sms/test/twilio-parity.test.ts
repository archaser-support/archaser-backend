import { createHmac } from "crypto";
import {
    buildWebhookUrl,
    sendViaTwilio,
    validateTwilioWebhookSignature,
} from "@archaser/sms-send";

describe("Twilio webhook signature (via @archaser/sms-send)", () => {
    const authToken = "test-auth-token";
    const url = "https://staging.archaser.com/api/sms/webhook/twilio";
    const body = {
        MessageSid: "SM123",
        MessageStatus: "delivered",
    };

    function sign(token: string, fullUrl: string, params: Record<string, string>) {
        const bodyString = new URLSearchParams(params).toString();
        return createHmac("sha1", token)
            .update(fullUrl + bodyString)
            .digest("base64");
    }

    it("accepts a valid signature", () => {
        const signature = sign(authToken, url, body);
        expect(
            validateTwilioWebhookSignature({
                authToken,
                signature,
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

    it("skips validation when auth token missing (legacy parity)", () => {
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

describe("sendViaTwilio (historical SMSVendorService parity)", () => {
    it("creates a message with statusCallback when webhook_url set", async () => {
        const create = jest.fn().mockResolvedValue({ sid: "SM999" });
        const factory = jest.fn().mockReturnValue({
            messages: { create },
        });

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
            {
                id: 1,
                account_sid: null,
                auth_token: null,
            },
            "+1",
            "+2",
            "x"
        );
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/missing account_sid/);
    });
});
