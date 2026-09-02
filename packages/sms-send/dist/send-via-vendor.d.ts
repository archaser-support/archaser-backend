import { SendViaVendorOptions, SmsSendResult, SmsVendorCreds } from "./types";
/**
 * Unified single-message send (D58, D60). No batch in S8.
 */
export declare function sendViaVendor(vendor: SmsVendorCreds, to: string, from: string, body: string, options?: SendViaVendorOptions): Promise<SmsSendResult>;
