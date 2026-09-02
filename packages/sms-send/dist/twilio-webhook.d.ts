/**
 * Parity with frontend/utils/webhookValidator.validateTwilioWebhook.
 */
export declare function validateTwilioWebhookSignature(input: {
    authToken: string | undefined;
    signature: string | undefined;
    url: string;
    body: string | Record<string, string>;
}): boolean;
export declare function buildWebhookUrl(req: {
    headers: Record<string, string | string[] | undefined>;
    originalUrl?: string;
    url?: string;
}): string;
