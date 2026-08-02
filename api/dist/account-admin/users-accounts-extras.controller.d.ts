import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class UsersExtrasController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    systemAdministratorCheck(user: JwtPayload): Promise<{
        isSystemAdministrator: boolean;
    }>;
    setViewAs(user: JwtPayload, body: {
        userId?: string;
    }): Promise<{
        success: boolean;
        viewAsUser: {
            email: string;
            account_id: number | null;
            role: import(".prisma/client").$Enums.user_role | null;
            name: string | null;
            id: string;
        };
    }>;
    clearViewAs(_user: JwtPayload): Promise<{
        success: boolean;
    }>;
    changePassword(user: JwtPayload, id: string, body: {
        password?: string;
        newPassword?: string;
    }): Promise<{
        success: boolean;
        message: string;
        userId: string;
    }>;
}
export declare class AccountsExtrasController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    gdprReport(user: JwtPayload, id: number): Promise<{
        account: {
            name: string | null;
            id: number;
            status: import(".prisma/client").$Enums.record_status;
            deleted_at: Date | null;
        };
        generatedAt: string;
        canRestore: boolean;
    }>;
    restore(user: JwtPayload, id: number): Promise<{
        success: boolean;
        restoredAt: string;
        account: {
            name: string | null;
            locale: string | null;
            primary_color: string | null;
            secondary_color: string | null;
            currency: string | null;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
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
}
