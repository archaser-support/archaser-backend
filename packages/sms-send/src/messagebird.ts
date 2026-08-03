import initMessageBird from "messagebird";
import {
    MessageBirdClientFactory,
    SmsSendResult,
    SmsVendorCreds,
} from "./types";

const defaultMessageBirdFactory: MessageBirdClientFactory = (apiKey) => {
    // messagebird CJS default export is a factory function
    const client = (initMessageBird as unknown as (key: string) => {
        messages: {
            create: (params: {
                originator: string;
                recipients: string[];
                body: string;
            }) => Promise<{ id: string; mtCount?: number }>;
        };
    })(apiKey);
    return client;
};

/**
 * Parity with historical SMSVendorService.sendViaMessageBird.
 */
export async function sendViaMessageBird(
    vendor: Pick<SmsVendorCreds, "id" | "api_key" | "cost_per_sms">,
    to: string,
    from: string,
    body: string,
    clientFactory: MessageBirdClientFactory = defaultMessageBirdFactory
): Promise<SmsSendResult> {
    if (!vendor.api_key) {
        return {
            success: false,
            error: `MessageBird vendor ${vendor.id} is missing api_key`,
            vendorId: vendor.id,
        };
    }
    const client = clientFactory(vendor.api_key);
    try {
        const message = await client.messages.create({
            originator: from,
            recipients: [to],
            body,
        });
        return {
            success: true,
            messageId: message.id,
            cost: vendor.cost_per_sms || 0,
            segments: message.mtCount || 1,
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
