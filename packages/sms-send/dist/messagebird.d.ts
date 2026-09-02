import { MessageBirdClientFactory, SmsSendResult, SmsVendorCreds } from "./types";
/**
 * Parity with historical SMSVendorService.sendViaMessageBird.
 */
export declare function sendViaMessageBird(vendor: Pick<SmsVendorCreds, "id" | "api_key" | "cost_per_sms">, to: string, from: string, body: string, clientFactory?: MessageBirdClientFactory): Promise<SmsSendResult>;
