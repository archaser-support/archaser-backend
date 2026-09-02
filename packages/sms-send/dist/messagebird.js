"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendViaMessageBird = sendViaMessageBird;
const messagebird_1 = __importDefault(require("messagebird"));
const defaultMessageBirdFactory = (apiKey) => {
    // messagebird CJS default export is a factory function
    const client = messagebird_1.default(apiKey);
    return client;
};
/**
 * Parity with historical SMSVendorService.sendViaMessageBird.
 */
async function sendViaMessageBird(vendor, to, from, body, clientFactory = defaultMessageBirdFactory) {
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
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            vendorId: vendor.id,
        };
    }
}
