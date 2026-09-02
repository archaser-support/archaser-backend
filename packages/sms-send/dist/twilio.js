"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendViaTwilio = sendViaTwilio;
const twilio_1 = __importDefault(require("twilio"));
/**
 * Parity with historical SMSVendorService.sendViaTwilio
 * (frontend git SHA 81bd37a…).
 */
async function sendViaTwilio(vendor, to, from, body, clientFactory = (sid, token) => (0, twilio_1.default)(sid, token)) {
    if (!vendor.account_sid || !vendor.auth_token) {
        return {
            success: false,
            error: `Twilio vendor ${vendor.id} is missing account_sid or auth_token`,
            vendorId: vendor.id,
        };
    }
    const client = clientFactory(vendor.account_sid, vendor.auth_token);
    try {
        const messageParams = {
            body,
            from: vendor.phone_number || from,
            to,
        };
        if (vendor.webhook_url) {
            messageParams.statusCallback = vendor.webhook_url;
        }
        const message = await client.messages.create(messageParams);
        return {
            success: true,
            messageId: message.sid,
            cost: vendor.cost_per_sms || 0,
            segments: Math.ceil(body.length / 160),
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
