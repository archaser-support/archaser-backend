import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class ReportsService {
    private readonly db;
    private readonly access;
    constructor(db: DatabaseService, access: AccessScopeService);
    list(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        reports: ({
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            context: string | null;
            description: string | null;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        })[];
        totalRecords: number;
        page: number;
        limit: number;
    }>;
    getById(user: JwtPayload, id: number): Promise<{
        report: {
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            context: string | null;
            description: string | null;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        report: {
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            context: string | null;
            description: string | null;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        report: {
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            context: string | null;
            description: string | null;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    remove(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
    metadata(user: JwtPayload): Promise<{
        tables: import("./report-metadata").TableMetadata[];
        relationships: import("./report-relationships").ReportRelationship[];
    }>;
    getUserDefault(user: JwtPayload, context: string): Promise<{
        report: ({
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                email: string;
                username: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            id: number;
            name: string;
            account_id: number;
            created_at: Date;
            modified_at: Date;
            context: string | null;
            description: string | null;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        }) | null;
    }>;
    setUserDefault(user: JwtPayload, context: string, reportId: number): Promise<{
        success: boolean;
        reportId: number;
    }>;
    clearUserDefault(user: JwtPayload, context: string): Promise<{
        success: boolean;
    }>;
    listShares(user: JwtPayload, reportId: number): Promise<{
        shares: {
            id: number;
            created_at: Date;
            created_by: string | null;
            permission: string;
            report_id: number;
            shared_with_user_id: string | null;
            shared_with_role: import(".prisma/client").$Enums.user_role | null;
        }[];
    }>;
    upsertShare(user: JwtPayload, reportId: number, body: Record<string, unknown>): Promise<{
        id: number;
        created_at: Date;
        created_by: string | null;
        permission: string;
        report_id: number;
        shared_with_user_id: string | null;
        shared_with_role: import(".prisma/client").$Enums.user_role | null;
    }>;
    listSchedules(user: JwtPayload, reportId: number): Promise<{
        schedules: {
            id: number;
            created_at: Date;
            modified_at: Date;
            is_active: boolean;
            last_run_at: Date | null;
            next_run_at: Date | null;
            report_id: number;
            schedule_type: string;
            schedule_config: import("@prisma/client/runtime/library").JsonValue;
        }[];
    }>;
    upsertSchedule(user: JwtPayload, reportId: number, body: Record<string, unknown>): Promise<{
        id: number;
        created_at: Date;
        modified_at: Date;
        is_active: boolean;
        last_run_at: Date | null;
        next_run_at: Date | null;
        report_id: number;
        schedule_type: string;
        schedule_config: import("@prisma/client/runtime/library").JsonValue;
    }>;
    syncSystem(user: JwtPayload): Promise<{
        success: boolean;
        synced: number;
        message: string;
    }>;
    private resolveDefaultView;
    private assertListPermission;
    private formatReportDates;
}
