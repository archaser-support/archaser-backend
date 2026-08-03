"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTwilioWebhookSignature = validateTwilioWebhookSignature;
exports.buildWebhookUrl = buildWebhookUrl;
const crypto_1 = require("crypto");
/**
 * Parity with frontend/utils/webhookValidator.validateTwilioWebhook
 * (historical production signature check).
 */
function validateTwilioWebhookSignature(input) {
    const { authToken, signature, url, body } = input;
    if (!authToken) {
        // Match legacy: skip validation when token missing (warn at call site).
        return true;
    }
    if (!signature) {
        return false;
    }
    const bodyString = typeof body === "string"
        ? body
        : new URLSearchParams(body).toString();
    const expectedSignature = (0, crypto_1.createHmac)("sha1", authToken)
        .update(url + bodyString)
        .digest("base64");
    return timingSafeEqual(signature, expectedSignature);
}
function timingSafeEqual(a, b) {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return (0, crypto_1.timingSafeEqual)(bufA, bufB);
}
function buildWebhookUrl(req) {
    const protoHeader = req.headers["x-forwarded-proto"];
    const protocol = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "https";
    const hostHeader = req.headers.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader || "";
    const path = (req.originalUrl || req.url || "").split("?")[0];
    return `${protocol}://${host}${path}`;
}
