import twilio from "twilio";
import {
    SmsSendResult,
    SmsVendorCreds,
    TwilioClientFactory,
} from "./types";
import { resolveTwilioStatusCallback } from "./twilio-webhook";

/**
 * Parity with historical SMSVendorService.sendViaTwilio
 * (frontend git SHA 81bd37a…).
 */
export async function sendViaTwilio(
    vendor: Pick<
        SmsVendorCreds,
        | "id"
        | "account_sid"
        | "auth_token"
        | "webhook_url"
        | "phone_number"
        | "cost_per_sms"
    >,
    to: string,
    from: string,
    body: string,
    clientFactory: TwilioClientFactory = (sid, token) => twilio(sid, token)
): Promise<SmsSendResult> {
    if (!vendor.account_sid || !vendor.auth_token) {
        return {
            success: false,
            error: `Twilio vendor ${vendor.id} is missing account_sid or auth_token`,
            vendorId: vendor.id,
        };
    }
    const client = clientFactory(vendor.account_sid, vendor.auth_token);
    try {
        const messageParams: {
            body: string;
            from: string;
            to: string;
            statusCallback?: string;
        } = {
            body,
            from: vendor.phone_number || from,
            to,
        };
        const statusCallback = resolveTwilioStatusCallback(vendor.webhook_url);
        if (statusCallback) {
            messageParams.statusCallback = statusCallback;
        }
        const message = await client.messages.create(messageParams);
        return {
            success: true,
            messageId: message.sid,
            cost: vendor.cost_per_sms || 0,
            segments: Math.ceil(body.length / 160),
            vendorId: vendor.id,
        };
    } catch (error: unknown) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            vendorId: vendor.id,
        };
    }
}

export async function fetchTwilioMessageStatus(
    vendor: Pick<SmsVendorCreds, "account_sid" | "auth_token">,
    messageSid: string
): Promise<{
    status: string;
    errorCode: number | null;
    errorMessage: string | null;
} | null> {
    if (!vendor.account_sid || !vendor.auth_token || !messageSid) {
        return null;
    }
    const client = twilio(vendor.account_sid, vendor.auth_token);
    const msg = await client.messages(messageSid).fetch();
    return {
        status: String(msg.status || ""),
        errorCode: msg.errorCode ?? null,
        errorMessage: msg.errorMessage ?? null,
    };
}
