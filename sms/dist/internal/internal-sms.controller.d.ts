import { SmsService } from "../sms/sms.service";
export declare class InternalSmsController {
    private readonly sms;
    constructor(sms: SmsService);
    send(body: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        mobileNumber: string;
        vendorId: number;
        provider: string;
        countryId: {} | null;
        messageId: string | null;
        vendorMessageId: string | null;
        cost: number | null;
        segments: number | null;
    }>;
}
