"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendViaVendor = sendViaVendor;
const inforu_1 = require("./inforu");
const messagebird_1 = require("./messagebird");
const twilio_1 = require("./twilio");
/**
 * Unified single-message send (D58, D60). No batch in S8.
 */
async function sendViaVendor(vendor, to, from, body, options = {}) {
    const provider = String(vendor.provider || "").toLowerCase();
    switch (provider) {
        case "twilio":
            return (0, twilio_1.sendViaTwilio)(vendor, to, vendor.phone_number || from, body, options.twilioClientFactory);
        case "messagebird":
            return (0, messagebird_1.sendViaMessageBird)(vendor, to, from, body, options.messageBirdClientFactory);
        case "inforu":
            return (0, inforu_1.sendViaInforu)(vendor, to, from, body, {
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
