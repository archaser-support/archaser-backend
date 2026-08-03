import { FetchLike, SmsSendResult, SmsVendorCreds } from "./types";
/**
 * Inforu single send — DB credentials only (D56).
 * Uses api_key + (api_secret || auth_token); fails if either missing.
 * Inforu webhook handling is out of scope for S8 (D59).
 */
export declare function sendViaInforu(vendor: Pick<SmsVendorCreds, "id" | "api_key" | "api_secret" | "auth_token" | "cost_per_sms">, to: string, from: string, body: string, options?: {
    fetchImpl?: FetchLike;
    webhookBaseUrl?: string;
}): Promise<SmsSendResult>;
