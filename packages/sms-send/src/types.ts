export interface SmsVendorCreds {
    id: number;
    provider: string;
    api_key?: string | null;
    api_secret?: string | null;
    account_sid?: string | null;
    auth_token?: string | null;
    webhook_url?: string | null;
    phone_number?: string | null;
    cost_per_sms?: number | null;
}

export interface SmsSendResult {
    success: boolean;
    messageId?: string;
    /** Vendor-side id when different from our customer message id (Inforu). */
    vendorMessageId?: string;
    cost?: number;
    segments?: number;
    error?: string;
    vendorId: number;
}

export type TwilioClientFactory = (
    accountSid: string,
    authToken: string
) => {
    messages: {
        create: (params: {
            body: string;
            from: string;
            to: string;
            statusCallback?: string;
        }) => Promise<{ sid: string }>;
    };
};

export type MessageBirdClientFactory = (apiKey: string) => {
    messages: {
        create: (params: {
            originator: string;
            recipients: string[];
            body: string;
        }) => Promise<{ id: string; mtCount?: number }>;
    };
};

export type FetchLike = typeof fetch;

export interface SendViaVendorOptions {
    twilioClientFactory?: TwilioClientFactory;
    messageBirdClientFactory?: MessageBirdClientFactory;
    fetchImpl?: FetchLike;
    /** Base URL for Inforu delivery notification (no trailing slash). */
    webhookBaseUrl?: string;
}
