import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/jwt-payload";
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
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_by: string | null;
            name: string;
            created_at: Date;
            modified_at: Date;
            modified_by: string | null;
            unique_name: string;
            description: string | null;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            is_default: boolean;
            context: string | null;
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
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_by: string | null;
            name: string;
            created_at: Date;
            modified_at: Date;
            modified_by: string | null;
            unique_name: string;
            description: string | null;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            is_default: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    /**
     * Reports are unique per (account_id, unique_name); append a numeric
     * suffix so two reports with the same name can coexist in an account.
     */
    private resolveAvailableUniqueName;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        report: {
            User_Report_created_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_by: string | null;
            name: string;
            created_at: Date;
            modified_at: Date;
            modified_by: string | null;
            unique_name: string;
            description: string | null;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            is_default: boolean;
            context: string | null;
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
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_by: string | null;
            name: string;
            created_at: Date;
            modified_at: Date;
            modified_by: string | null;
            unique_name: string;
            description: string | null;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            is_default: boolean;
            context: string | null;
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
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
            User_Report_modified_byToUser: {
                id: string;
                name: string | null;
                first_name: string | null;
                last_name: string | null;
                email: string;
                username: string;
            } | null;
        } & {
            account_id: number;
            id: number;
            created_by: string | null;
            name: string;
            created_at: Date;
            modified_at: Date;
            modified_by: string | null;
            unique_name: string;
            description: string | null;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            is_default: boolean;
            context: string | null;
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
            created_by: string | null;
            created_at: Date;
            report_id: number;
            shared_with_user_id: string | null;
            shared_with_role: import(".prisma/client").$Enums.user_role | null;
            permission: string;
        }[];
    }>;
    upsertShare(user: JwtPayload, reportId: number, body: Record<string, unknown>): Promise<{
        id: number;
        created_by: string | null;
        created_at: Date;
        report_id: number;
        shared_with_user_id: string | null;
        shared_with_role: import(".prisma/client").$Enums.user_role | null;
        permission: string;
    }>;
    listSchedules(user: JwtPayload, reportId: number): Promise<{
        schedules: {
            id: number;
            created_at: Date;
            modified_at: Date;
            report_id: number;
            schedule_type: string;
            schedule_config: import("@prisma/client/runtime/library").JsonValue;
            is_active: boolean;
            last_run_at: Date | null;
            next_run_at: Date | null;
        }[];
    }>;
    upsertSchedule(user: JwtPayload, reportId: number, body: Record<string, unknown>): Promise<{
        id: number;
        created_at: Date;
        modified_at: Date;
        report_id: number;
        schedule_type: string;
        schedule_config: import("@prisma/client/runtime/library").JsonValue;
        is_active: boolean;
        last_run_at: Date | null;
        next_run_at: Date | null;
    }>;
    /**
     * Copy selected system reports from master account 10013 onto every other
     * active account (match by unique_name). Used by "Sync to all accounts".
     */
    syncSystem(user: JwtPayload, body?: {
        reportIds?: number[];
    }): Promise<{
        syncedReports: number;
        targetAccounts: number;
        created: number;
        updated: number;
    }>;
    private resolveDefaultView;
    private assertListPermission;
    private formatReportDates;
}
