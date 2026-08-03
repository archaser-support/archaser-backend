"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendViaInforu = sendViaInforu;
/**
 * Inforu single send — DB credentials only (D56).
 * Uses api_key + (api_secret || auth_token); fails if either missing.
 * Inforu webhook handling is out of scope for S8 (D59).
 */
async function sendViaInforu(vendor, to, from, body, options = {}) {
    const apiSecret = vendor.api_secret || vendor.auth_token;
    if (!vendor.api_key || !apiSecret) {
        return {
            success: false,
            error: `Inforu vendor ${vendor.id} is missing api_key or api_secret/auth_token`,
            vendorId: vendor.id,
        };
    }
    const fetchImpl = options.fetchImpl || fetch;
    const customerMessageID = crypto.randomUUID();
    const base = options.webhookBaseUrl ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.SMS_WEBHOOK_BASE_URL ||
        "";
    const jsonData = {
        Data: {
            Message: body,
            Recipients: [{ Phone: to }],
            Settings: {
                Sender: from,
                ...(base
                    ? {
                        DeliveryNotificationUrl: `${base.replace(/\/$/, "")}/api/sms/webhook/inforu`,
                    }
                    : {}),
                CustomerMessageID: customerMessageID,
            },
        },
    };
    const credentials = `${vendor.api_key}:${apiSecret}`;
    const encoded = Buffer.from(credentials, "utf8").toString("base64");
    try {
        const response = await fetchImpl("https://capi.inforu.co.il/api/v2/SMS/SendSms", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${encoded}`,
            },
            body: JSON.stringify(jsonData),
        });
        const responseData = (await response.json());
        if (responseData.StatusId === 1) {
            const vendorMessageId = responseData.MessageID ||
                responseData.MessageId ||
                responseData.Id;
            return {
                success: true,
                messageId: customerMessageID,
                vendorMessageId,
                cost: vendor.cost_per_sms || 0,
                segments: Math.ceil(body.length / 160),
                vendorId: vendor.id,
            };
        }
        const errorMessage = responseData.StatusDescription ||
            responseData.DetailedDescription ||
            "Unknown error from Inforu";
        return {
            success: false,
            error: errorMessage,
            vendorId: vendor.id,
        };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            vendorId: vendor.id,
        };
    }
}
