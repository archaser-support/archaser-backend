import { AccessScopeService, JwtPayload } from "@archaser/auth";
import { SendViaVendorOptions, TwilioClientFactory } from "@archaser/sms-send";
import { DatabaseService } from "../database/database.service";
export declare class SmsService {
    private readonly db;
    private readonly accessScope;
    private readonly logger;
    private sendOptions;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    /** Test seam — inject vendor client factories / fetch. */
    setSendOptions(options: SendViaVendorOptions): void;
    /** @deprecated Prefer setSendOptions */
    setTwilioClientFactory(factory: TwilioClientFactory): void;
    private assertAdmin;
    isBlockedForCountry(countryId: number): Promise<boolean>;
    isBlockedForAccountCountry(accountId: number, countryId: number): Promise<boolean>;
    checkBlocking(_user: JwtPayload, countryId: number, accountId?: number): Promise<{
        isBlocked: boolean;
        countryId: number;
        accountId: number | undefined;
    }>;
    checkBlockingWithActivities(_user: JwtPayload, countryId: number, accountId: number, customerId: number): Promise<{
        isBlocked: boolean;
        hasSMSActivities: boolean;
        countryId: number;
        accountId: number;
        customerId: number;
    }>;
    listVendors(user: JwtPayload, query?: Record<string, string | undefined>): Promise<{
        id: number;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        name: string;
        provider: string;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        priority: number | null;
        use_account_sender_name: boolean | null;
    }[]>;
    private vendorOrderBy;
    createVendor(user: JwtPayload, body: Record<string, unknown>): Promise<{
        id: number;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        name: string;
        provider: string;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        priority: number | null;
        use_account_sender_name: boolean | null;
    }>;
    getVendor(user: JwtPayload, id: number): Promise<{
        id: number;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        name: string;
        provider: string;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        priority: number | null;
        use_account_sender_name: boolean | null;
    }>;
    updateVendor(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        id: number;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        created_by: string | null;
        modified_by: string | null;
        name: string;
        provider: string;
        api_key: string | null;
        api_secret: string | null;
        account_sid: string | null;
        auth_token: string | null;
        webhook_url: string | null;
        priority: number | null;
        use_account_sender_name: boolean | null;
    }>;
    deleteVendor(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
    listCountryVendors(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        countryVendors: ({
            Country: {
                id: number;
                name: string;
                iso2: string | null;
                emoji: string | null;
            };
            SMSVendor: {
                id: number;
                is_active: boolean | null;
                name: string;
                provider: string;
            };
        } & {
            id: number;
            country_id: number;
            vendor_id: number;
            is_default: boolean | null;
            is_active: boolean | null;
            created_at: Date | null;
            modified_at: Date | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            currency: string | null;
            comment: string | null;
            phone_number: string | null;
            created_by: string | null;
            modified_by: string | null;
        })[];
        totalRecords: number;
        page: number;
        limit: number;
    }>;
    private countryVendorOrderBy;
    createCountryVendor(user: JwtPayload, body: Record<string, unknown>): Promise<{
        Country: {
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            name: string;
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
            id: number;
            is_active: boolean | null;
            created_at: Date | null;
            modified_at: Date | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            name: string;
            provider: string;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            priority: number | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        country_id: number;
        vendor_id: number;
        is_default: boolean | null;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        comment: string | null;
        phone_number: string | null;
        created_by: string | null;
        modified_by: string | null;
    }>;
    getCountryVendor(user: JwtPayload, id: number): Promise<{
        Country: {
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            name: string;
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
            id: number;
            is_active: boolean | null;
            created_at: Date | null;
            modified_at: Date | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            name: string;
            provider: string;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            priority: number | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        country_id: number;
        vendor_id: number;
        is_default: boolean | null;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        comment: string | null;
        phone_number: string | null;
        created_by: string | null;
        modified_by: string | null;
    }>;
    updateCountryVendor(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        Country: {
            id: number;
            created_at: Date | null;
            modified_at: Date;
            currency: string | null;
            name: string;
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
            id: number;
            is_active: boolean | null;
            created_at: Date | null;
            modified_at: Date | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            name: string;
            provider: string;
            api_key: string | null;
            api_secret: string | null;
            account_sid: string | null;
            auth_token: string | null;
            webhook_url: string | null;
            priority: number | null;
            use_account_sender_name: boolean | null;
        };
    } & {
        id: number;
        country_id: number;
        vendor_id: number;
        is_default: boolean | null;
        is_active: boolean | null;
        created_at: Date | null;
        modified_at: Date | null;
        cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        currency: string | null;
        comment: string | null;
        phone_number: string | null;
        created_by: string | null;
        modified_by: string | null;
    }>;
    deleteCountryVendor(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
    testSms(user: JwtPayload, body: Record<string, unknown>): Promise<{
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
    /**
     * Internal send used by api/worker (D32).
     * Body: { to, body, from?, vendorId?, countryId?, accountId? }
     */
    sendInternal(body: Record<string, unknown>): Promise<{
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
    handleTwilioWebhook(body: Record<string, unknown>, req: {
        headers: Record<string, string | string[] | undefined>;
        originalUrl?: string;
        url?: string;
    }): Promise<{
        success: boolean;
    }>;
    private resolveTwilioAuthTokenForWebhook;
}
