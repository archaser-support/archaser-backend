import { JwtPayload } from "../auth/auth.service";
import { ActivitiesService } from "./activities.service";
export declare class ActivitySequencesController {
    private readonly activities;
    constructor(activities: ActivitiesService);
    list(user: JwtPayload, query: {
        account_id?: string;
        sequence_container_id?: string;
    }): Promise<{
        activitiesSequences: ({
            ActivitiesTemplate: {
                id: number;
                name: string;
                language: import(".prisma/client").$Enums.language | null;
                category: import(".prisma/client").$Enums.category | null;
            } | null;
            SequenceContainer: {
                id: number;
                account_id: number;
                active: boolean;
                category: import(".prisma/client").$Enums.category;
                is_deleted: boolean;
            } | null;
        } & {
            id: number;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            step: number | null;
            active: boolean;
            sequence_container_id: number | null;
            activity_type: import(".prisma/client").$Enums.activity_type;
            category: import(".prisma/client").$Enums.category;
            days_from_prev_step: number | null;
            step_type: import(".prisma/client").$Enums.step_type | null;
            days_before_due: number | null;
            activity_template_id: number | null;
            master_template: boolean | null;
            last_category_step: boolean;
            time_of_day: string | null;
            days_after_start: number | null;
            send_to_escalated_contacts: boolean | null;
            send_to_standard_contacts: boolean | null;
        })[];
    }>;
    activityTemplates(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        templates: ({
            User_ActivitiesTemplate_created_byToUser: {
                id: string;
                name: string | null;
                account_id: number | null;
                created_at: Date;
                modified_at: Date;
                email: string;
                status: import(".prisma/client").$Enums.record_status;
                created_by: string | null;
                modified_by: string | null;
                language: import(".prisma/client").$Enums.language;
                username: string;
                emailVerified: Date | null;
                image: string | null;
                password: string | null;
                resetToken: string | null;
                resetTokenExpiry: Date | null;
                first_name: string | null;
                last_name: string | null;
                role: import(".prisma/client").$Enums.user_role | null;
                mobile: string | null;
                time_zone: string | null;
                currency: string | null;
                locale: string | null;
                session_version: number;
                freeze: boolean;
                sidebar_collapsed: boolean | null;
                failed_login_attempts: number;
                last_failed_login_at: Date | null;
                deactivated_at: Date | null;
                guided_tooltips_enabled: boolean | null;
                is_audit_user: boolean;
                business_unit_id: number | null;
            } | null;
            User_ActivitiesTemplate_modified_byToUser: {
                id: string;
                name: string | null;
                account_id: number | null;
                created_at: Date;
                modified_at: Date;
                email: string;
                status: import(".prisma/client").$Enums.record_status;
                created_by: string | null;
                modified_by: string | null;
                language: import(".prisma/client").$Enums.language;
                username: string;
                emailVerified: Date | null;
                image: string | null;
                password: string | null;
                resetToken: string | null;
                resetTokenExpiry: Date | null;
                first_name: string | null;
                last_name: string | null;
                role: import(".prisma/client").$Enums.user_role | null;
                mobile: string | null;
                time_zone: string | null;
                currency: string | null;
                locale: string | null;
                session_version: number;
                freeze: boolean;
                sidebar_collapsed: boolean | null;
                failed_login_attempts: number;
                last_failed_login_at: Date | null;
                deactivated_at: Date | null;
                guided_tooltips_enabled: boolean | null;
                is_audit_user: boolean;
                business_unit_id: number | null;
            } | null;
            ActivityTemplateLanguage: {
                id: number;
                created_at: Date;
                modified_at: Date;
                created_by: string | null;
                modified_by: string | null;
                language: string;
                template_id: number;
                sms_content: string | null;
                whatsapp_content: string | null;
                email_subject: string | null;
                email_content: string | null;
            }[];
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            language: import(".prisma/client").$Enums.language | null;
            active: boolean | null;
            category: import(".prisma/client").$Enums.category | null;
            master_template: boolean | null;
            dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
        })[];
        totalRecords: number;
    }>;
}
