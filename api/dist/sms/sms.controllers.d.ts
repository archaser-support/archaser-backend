import { JwtPayload } from "../auth/auth.service";
import { SmsService } from "./sms.service";
export declare class SmsController {
    private readonly sms;
    constructor(sms: SmsService);
    checkBlocking(user: JwtPayload, countryIdRaw: string, accountIdRaw?: string): Promise<{
        isBlocked: boolean;
        countryId: number;
        accountId: number | undefined;
    } | {
        error: string;
    }>;
    checkBlockingWithActivities(user: JwtPayload, countryIdRaw: string, accountIdRaw: string, customerIdRaw: string): Promise<{
        isBlocked: boolean;
        hasSMSActivities: boolean;
        countryId: number;
        accountId: number;
        customerId: number;
    } | {
        error: string;
    }>;
    test(user: JwtPayload, body: Record<string, unknown>): Promise<{
        success: boolean;
        message: string;
        mobileNumber: {};
        vendorId: {} | null;
        countryId: {} | null;
    }>;
}
export declare class SmsVendorsController {
    private readonly sms;
    constructor(sms: SmsService);
    list(user: JwtPayload): Promise<{
        name: string;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        provider: string;
        priority: number | null;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        use_account_sender_name: boolean | null;
    }[]>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        name: string;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        provider: string;
        priority: number | null;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        use_account_sender_name: boolean | null;
    }>;
    byId(user: JwtPayload, id: number): Promise<{
        name: string;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        provider: string;
        priority: number | null;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        use_account_sender_name: boolean | null;
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        name: string;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        provider: string;
        priority: number | null;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        use_account_sender_name: boolean | null;
    }>;
    remove(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
}
export declare class SmsCountryVendorsController {
    private readonly sms;
    constructor(sms: SmsService);
    list(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        countryVendors: ({
            Country: {
                name: string;
                id: number;
                iso2: string | null;
                emoji: string | null;
            };
            SMSVendor: {
                name: string;
                id: number;
                provider: string;
                is_active: boolean | null;
            };
        } & {
            id: number;
            created_at: Date | null;
            modified_at: Date | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            country_id: number;
            vendor_id: number;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            is_default: boolean | null;
            comment: string | null;
            phone_number: string | null;
        })[];
        totalRecords: number;
        page: number;
        limit: number;
    }>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            iso3: string | null;
            numeric_code: string | null;
            iso2: string | null;
            phonecode: string | null;
            capital: string | null;
            currency_name: string | null;
            currency_symbol: string | null;
            tld: string | null;
            native: string | null;
            region: string | null;
            region_id: number | null;
            subregion: string | null;
            subregion_id: number | null;
            nationality: string | null;
            translations: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            emoji: string | null;
            emojiU: string | null;
            flag: number;
            wikiDataId: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            provider: string;
            priority: number | null;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        is_default: boolean | null;
        comment: string | null;
        phone_number: string | null;
    }>;
    byId(user: JwtPayload, id: number): Promise<{
        Country: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            iso3: string | null;
            numeric_code: string | null;
            iso2: string | null;
            phonecode: string | null;
            capital: string | null;
            currency_name: string | null;
            currency_symbol: string | null;
            tld: string | null;
            native: string | null;
            region: string | null;
            region_id: number | null;
            subregion: string | null;
            subregion_id: number | null;
            nationality: string | null;
            translations: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            emoji: string | null;
            emojiU: string | null;
            flag: number;
            wikiDataId: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            provider: string;
            priority: number | null;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        is_default: boolean | null;
        comment: string | null;
        phone_number: string | null;
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            iso3: string | null;
            numeric_code: string | null;
            iso2: string | null;
            phonecode: string | null;
            capital: string | null;
            currency_name: string | null;
            currency_symbol: string | null;
            tld: string | null;
            native: string | null;
            region: string | null;
            region_id: number | null;
            subregion: string | null;
            subregion_id: number | null;
            nationality: string | null;
            translations: string | null;
            latitude: import("@prisma/client/runtime/library").Decimal | null;
            longitude: import("@prisma/client/runtime/library").Decimal | null;
            emoji: string | null;
            emojiU: string | null;
            flag: number;
            wikiDataId: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            created_at: Date | null;
            modified_at: Date | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            provider: string;
            priority: number | null;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_active: boolean | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        is_default: boolean | null;
        comment: string | null;
        phone_number: string | null;
    }>;
    remove(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
}
export declare class SmsWebhookController {
    private readonly sms;
    constructor(sms: SmsService);
    twilio(body: Record<string, unknown>): Promise<{
        success: boolean;
    }>;
}
