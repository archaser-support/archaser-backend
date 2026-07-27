import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class AccountsNestedService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private assertAccountAccess;
    private assertAdmin;
    getAccount(user: JwtPayload, accountId: number): Promise<{
        data: {
            name: string | null;
            locale: string | null;
            primary_color: string | null;
            secondary_color: string | null;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            currency: string | null;
            created_by: string | null;
            modified_by: string | null;
            address_line1: string | null;
            city: string | null;
            postal_code: string | null;
            address_line2: string | null;
            country_id: number | null;
            promise_to_pay: number;
            state_id: number | null;
            company_number: string | null;
            client_type: import(".prisma/client").$Enums.customer_client_type;
            sms_from_name: string | null;
            sub_domain: string | null;
            no_of_auomated_steps: number;
            category_after_automated: import(".prisma/client").$Enums.category | null;
            allow_partial_payment: boolean;
            bank_comments: string | null;
            logo: string | null;
            chart_palette_color: string | null;
            default_language: import(".prisma/client").$Enums.language | null;
            start_days_after_due: number;
            email_from_name: string | null;
            email_server_host: string | null;
            email_from: string | null;
            email_server_user: string | null;
            email_server_password: string | null;
            email_server_port: number | null;
            wait_days_after_automated: number;
            max_promise_to_pay_allowed_per_cycle: number | null;
            next_activity_date: Date | null;
            beneficiary_name: string | null;
            bank_name: string | null;
            branch_number: string | null;
            branch_name: string | null;
            swift: string | null;
            iban: string | null;
            account_number: string | null;
            balance_evaluation_method: string | null;
            generic_field_config: import("@prisma/client/runtime/library").JsonValue | null;
            use_customer_language: boolean | null;
            last_sync_date: Date | null;
            default_first_activity_delay_days: number | null;
            sms_fallback_enabled: boolean | null;
            unlisted_country_sms_policy: string | null;
            intelligent_channel_selection_enabled: boolean | null;
            category_for_new_collection: import(".prisma/client").$Enums.category | null;
            portal_verification_enabled: boolean | null;
            sso_enabled: boolean | null;
            sso_providers: string | null;
            has_collection: boolean;
            has_credit_insurance: boolean;
            enable_customer_checkpoints: boolean;
            credit_limit_warning_threshold_pct: number | null;
            credit_score_validity_warning_days: number | null;
            reporting_date_warning_days: number | null;
            customer_limit_expiration_warning_days: number | null;
            deleted_at: Date | null;
            deleted_by: string | null;
        };
    }>;
    listSmsPreferences(user: JwtPayload, accountId: number, countryId?: string): Promise<({
        Country: {
            name: string;
            id: number;
            iso3: string | null;
            iso2: string | null;
            phonecode: string | null;
            emoji: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            currency: string | null;
            provider: string;
            priority: number | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        };
    } & {
        account_id: number;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_enabled: boolean | null;
        priority: number | null;
    })[]>;
    createSmsPreference(user: JwtPayload, accountId: number, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            iso3: string | null;
            iso2: string | null;
            phonecode: string | null;
            emoji: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            currency: string | null;
            provider: string;
            priority: number | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        };
    } & {
        account_id: number;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_enabled: boolean | null;
        priority: number | null;
    }>;
    getSmsPreference(user: JwtPayload, accountId: number, preferenceId: number): Promise<{
        SMSVendor: {
            phone_number: string | null;
            name: string;
            id: number;
            currency: string | null;
            provider: string;
            priority: number | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        };
        Country: {
            name: string;
            id: number;
            iso3: string | null;
            iso2: string | null;
            phonecode: string | null;
            emoji: string | null;
        };
        account_id: number;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_enabled: boolean | null;
        priority: number | null;
    }>;
    updateSmsPreference(user: JwtPayload, accountId: number, preferenceId: number, body: Record<string, unknown>): Promise<{
        Country: {
            name: string;
            id: number;
            iso3: string | null;
            iso2: string | null;
            phonecode: string | null;
            emoji: string | null;
        };
        SMSVendor: {
            name: string;
            id: number;
            currency: string | null;
            provider: string;
            priority: number | null;
            is_active: boolean | null;
            cost_per_sms: import("@prisma/client/runtime/library").Decimal | null;
        };
    } & {
        account_id: number;
        id: number;
        created_at: Date | null;
        modified_at: Date | null;
        created_by: string | null;
        modified_by: string | null;
        country_id: number;
        vendor_id: number;
        is_enabled: boolean | null;
        priority: number | null;
    }>;
    deleteSmsPreference(user: JwtPayload, accountId: number, preferenceId: number): Promise<{
        success: boolean;
    }>;
    updateGenericFieldConfig(user: JwtPayload, accountId: number, body: Record<string, unknown>): Promise<{
        success: boolean;
        generic_field_config: Record<"contact" | "customer" | "invoice" | "payment", {
            text1: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
            text2: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
            number1: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
            number2: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
            date1: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
            date2: {
                enabled: boolean;
                label: string;
                read_only: boolean;
            };
        }>;
    }>;
    checkUsername(username: string, excludeUserId?: string): Promise<{
        success: boolean;
        available: boolean;
        username: string;
    }>;
    private toPublicBillingConfig;
    getBillingConnector(user: JwtPayload, accountId: number): Promise<{
        config: {
            sync_states: {
                entity_type: import(".prisma/client").$Enums.ImportType;
                backfill_completed: boolean;
                backfill_completed_at: string | null;
                backfill_cursor_present: boolean;
                backfill_records_pulled: number;
                backfill_total_records: number | null;
                last_max_updated_at: string | null;
                last_successful_run_at: string | null;
                last_attempt_at: string | null;
                last_error: string | null;
            }[];
            id: number;
            account_id: number;
            provider: string;
            status: string;
            base_url: string | null;
            auth_type: string;
            has_credentials: boolean;
            sync_enabled: boolean;
            sync_cron_expression: string;
            sync_mode: string;
            enabled_entities: unknown;
            sync_overlap_minutes: number;
            consecutive_auth_failures: number;
            last_connection_test_at: string | null;
            last_connection_error: string | null;
            created_at: string;
            modified_at: string;
            schedule_summary: string;
            next_scheduled_sync_at_utc: null;
            schedule_preset: null;
            schedule_warning: null;
        };
    } | {
        config: null;
    }>;
    upsertBillingConnector(user: JwtPayload, accountId: number, body: Record<string, unknown>): Promise<{
        config: {
            id: number;
            account_id: number;
            provider: string;
            status: string;
            base_url: string | null;
            auth_type: string;
            has_credentials: boolean;
            sync_enabled: boolean;
            sync_cron_expression: string;
            sync_mode: string;
            enabled_entities: unknown;
            sync_overlap_minutes: number;
            consecutive_auth_failures: number;
            last_connection_test_at: string | null;
            last_connection_error: string | null;
            created_at: string;
            modified_at: string;
            schedule_summary: string;
            next_scheduled_sync_at_utc: null;
            schedule_preset: null;
            schedule_warning: null;
        };
    }>;
    billingConnectorAction(user: JwtPayload, accountId: number, action: "test" | "sync" | "sync-runs" | "backfill-reset", body?: Record<string, unknown>): Promise<{
        ok: boolean;
        success: boolean;
        queued?: undefined;
        reset?: undefined;
        runs?: undefined;
    } | {
        ok: boolean;
        queued: boolean;
        success?: undefined;
        reset?: undefined;
        runs?: undefined;
    } | {
        ok: boolean;
        reset: boolean;
        success?: undefined;
        queued?: undefined;
        runs?: undefined;
    } | {
        runs: never[];
        ok?: undefined;
        success?: undefined;
        queued?: undefined;
        reset?: undefined;
    }>;
    getBillingMappings(user: JwtPayload, accountId: number, importType: string): Promise<{
        mapping: {
            id: number;
            modified_at: Date;
            modified_by: string | null;
            connector_id: number;
            import_type: import(".prisma/client").$Enums.ImportType;
            mapping: import("@prisma/client/runtime/library").JsonValue;
            is_complete: boolean;
        } | null;
    }>;
    putBillingMappings(user: JwtPayload, accountId: number, importType: string, body: Record<string, unknown>): Promise<{
        mapping: {
            id: number;
            modified_at: Date;
            modified_by: string | null;
            connector_id: number;
            import_type: import(".prisma/client").$Enums.ImportType;
            mapping: import("@prisma/client/runtime/library").JsonValue;
            is_complete: boolean;
        };
    }>;
    discoverBillingFields(user: JwtPayload, accountId: number, importType: string): Promise<{
        importType: string;
        fields: never[];
    }>;
    private mapRuleSets;
    listNotificationRuleSets(user: JwtPayload, accountId: number): Promise<{
        sets: {
            id: number;
            account_id: number;
            product: string;
            trigger_type: string;
            enabled: boolean;
            rules: {
                id: number;
                advance_day_offsets: number[];
                role_defaults: string[];
                user_overrides: {
                    id: number;
                    user_id: string;
                }[];
            }[];
        }[];
    }>;
    updateNotificationRuleSet(user: JwtPayload, accountId: number, setId: number, body: Record<string, unknown>): Promise<{
        sets: {
            id: number;
            account_id: number;
            product: string;
            trigger_type: string;
            enabled: boolean;
            rules: {
                id: number;
                advance_day_offsets: number[];
                role_defaults: string[];
                user_overrides: {
                    id: number;
                    user_id: string;
                }[];
            }[];
        }[];
    }>;
}
