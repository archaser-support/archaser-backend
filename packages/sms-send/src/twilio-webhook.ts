import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

/**
 * Parity with frontend/utils/webhookValidator.validateTwilioWebhook.
 */
export function validateTwilioWebhookSignature(input: {
    authToken: string | undefined;
    signature: string | undefined;
    url: string;
    body: string | Record<string, string>;
}): boolean {
    const { authToken, signature, url, body } = input;
    if (!authToken) {
        return true;
    }
    if (!signature) {
        return false;
    }
    const bodyString =
        typeof body === "string"
            ? body
            : new URLSearchParams(body).toString();
    const expectedSignature = createHmac("sha1", authToken)
        .update(url + bodyString)
        .digest("base64");
    return timingSafeEqual(signature, expectedSignature);
}

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return cryptoTimingSafeEqual(bufA, bufB);
}

export function buildWebhookUrl(req: {
    headers: Record<string, string | string[] | undefined>;
    originalUrl?: string;
    url?: string;
}): string {
    const protoHeader = req.headers["x-forwarded-proto"];
    const protocol =
        (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "https";
    const hostHeader = req.headers.host;
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader || "";
    const path = (req.originalUrl || req.url || "").split("?")[0];
    return `${protocol}://${host}${path}`;
}
