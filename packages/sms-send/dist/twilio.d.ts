import { SmsSendResult, SmsVendorCreds, TwilioClientFactory } from "./types";
/**
 * Parity with historical SMSVendorService.sendViaTwilio
 * (frontend git SHA 81bd37a…).
 */
export declare function sendViaTwilio(vendor: Pick<SmsVendorCreds, "id" | "account_sid" | "auth_token" | "webhook_url" | "phone_number" | "cost_per_sms">, to: string, from: string, body: string, clientFactory?: TwilioClientFactory): Promise<SmsSendResult>;
