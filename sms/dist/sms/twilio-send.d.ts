export type TwilioClientFactory = (accountSid: string, authToken: string) => {
    messages: {
        create: (params: {
            body: string;
            from: string;
            to: string;
            statusCallback?: string;
        }) => Promise<{
            sid: string;
        }>;
    };
};
export interface TwilioVendorCreds {
    id: number;
    account_sid: string | null;
    auth_token: string | null;
    webhook_url?: string | null;
    phone_number?: string | null;
    cost_per_sms?: number | null;
}
export interface TwilioSendResult {
    success: boolean;
    messageId?: string;
    cost?: number;
    segments?: number;
    error?: string;
    vendorId: number;
}
/**
 * Parity with historical SMSVendorService.sendViaTwilio
 * (frontend git SHA 81bd37a…).
 */
export declare function sendViaTwilio(vendor: TwilioVendorCreds, to: string, from: string, body: string, clientFactory?: TwilioClientFactory): Promise<TwilioSendResult>;
