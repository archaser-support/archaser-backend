import { sendViaInforu } from "./inforu";
import { sendViaMessageBird } from "./messagebird";
import { sendViaTwilio } from "./twilio";
import {
    SendViaVendorOptions,
    SmsSendResult,
    SmsVendorCreds,
} from "./types";

/**
 * Unified single-message send (D58, D60). No batch in S8.
 */
export async function sendViaVendor(
    vendor: SmsVendorCreds,
    to: string,
    from: string,
    body: string,
    options: SendViaVendorOptions = {}
): Promise<SmsSendResult> {
    const provider = String(vendor.provider || "").toLowerCase();
    switch (provider) {
        case "twilio":
            return sendViaTwilio(
                vendor,
                to,
                vendor.phone_number || from,
                body,
                options.twilioClientFactory
            );
        case "messagebird":
            return sendViaMessageBird(
                vendor,
                to,
                from,
                body,
                options.messageBirdClientFactory
            );
        case "inforu":
            return sendViaInforu(vendor, to, from, body, {
                fetchImpl: options.fetchImpl,
                webhookBaseUrl: options.webhookBaseUrl,
            });
        default:
            return {
                success: false,
                error: `Unsupported SMS provider: ${vendor.provider}`,
                vendorId: vendor.id,
            };
    }
}
