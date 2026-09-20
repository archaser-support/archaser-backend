import { createHmac, timingSafeEqual as cryptoTimingSafeEqual } from "crypto";

function firstHeader(
    value: string | string[] | undefined
): string | undefined {
    if (Array.isArray(value)) {
        return value[0];
    }
    return value;
}

function paramsFromBody(
    body: string | Record<string, string>
): Record<string, string> {
    if (typeof body === "string") {
        return Object.fromEntries(new URLSearchParams(body));
    }
    return body;
}

function signatureMatches(
    authToken: string,
    signature: string,
    url: string,
    params: Record<string, string>
): boolean {
    const data = Object.keys(params)
        .sort()
        .reduce((acc, key) => acc + key + params[key], url);
    const expected = createHmac("sha1", authToken)
        .update(Buffer.from(data, "utf-8"))
        .digest("base64");
    return timingSafeEqual(signature, expected);
}

/**
 * Twilio signs `url + sortedKeyValuePairs` (not `application/x-www-form-urlencoded`).
 * Try every public URL the proxy may have rewritten, because Amplify/nginx
 * often present a different Host than the URL Twilio posted to.
 */
export function validateTwilioWebhookSignature(input: {
    authToken: string | undefined;
    signature: string | undefined;
    url: string;
    body: string | Record<string, string>;
    extraUrls?: Array<string | undefined | null>;
}): boolean {
    const { authToken, signature, url, body, extraUrls = [] } = input;
    if (!authToken) {
        return true;
    }
    if (!signature) {
        return false;
    }
    const params = paramsFromBody(body);
    const candidates = [url, ...extraUrls].filter(
        (candidate): candidate is string =>
            typeof candidate === "string" && candidate.length > 0
    );
    return candidates.some((candidate) =>
        signatureMatches(authToken, signature, candidate, params)
    );
}

function timingSafeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        return false;
    }
    return cryptoTimingSafeEqual(bufA, bufB);
}

export function twilioStatusCallbackFromPublicBase(
    publicBase?: string | null
): string | undefined {
    const base = publicBase?.trim();
    if (!base) {
        return undefined;
    }
    return `${base.replace(/\/$/, "")}/api/sms/webhook/twilio`;
}

/** Prefer the Nest API host so Twilio posts to nginx → SMS, not the Amplify portal. */
export function resolveTwilioStatusCallback(
    vendorWebhookUrl?: string | null
): string | undefined {
    const explicit = process.env.SMS_WEBHOOK_PUBLIC_URL?.trim();
    if (explicit) {
        return explicit;
    }
    const fromNest = twilioStatusCallbackFromPublicBase(
        process.env.NEST_PUBLIC_URL
    );
    if (fromNest) {
        return fromNest;
    }
    const vendor = vendorWebhookUrl?.trim();
    return vendor || undefined;
}

export function buildWebhookUrl(req: {
    headers: Record<string, string | string[] | undefined>;
    originalUrl?: string;
    url?: string;
}): string {
    const protocol =
        firstHeader(req.headers["x-forwarded-proto"]) || "https";
    const host =
        firstHeader(req.headers["x-forwarded-host"]) ||
        firstHeader(req.headers.host) ||
        "";
    const path = (req.originalUrl || req.url || "").split("?")[0];
    return `${protocol}://${host}${path}`;
}
