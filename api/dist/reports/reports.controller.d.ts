import { JwtPayload } from "../auth/auth.service";
import { ExecuteReportDto } from "./dto/execute-report.dto";
import { ReportExecutionService } from "./report-execution.service";
import { ReportsService } from "./reports.service";
export declare class ReportsController {
    private readonly reports;
    private readonly execution;
    constructor(reports: ReportsService, execution: ReportExecutionService);
    list(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        reports: ({
            User_Report_created_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            description: string | null;
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        })[];
        totalRecords: number;
        page: number;
        limit: number;
    }>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        report: {
            User_Report_created_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            description: string | null;
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    metadata(user: JwtPayload): Promise<{
        tables: import("./report-metadata").TableMetadata[];
        relationships: import("./report-relationships").ReportRelationship[];
    }>;
    getUserDefault(user: JwtPayload, context: string): Promise<{
        report: ({
            User_Report_created_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            description: string | null;
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        }) | null;
    }>;
    setUserDefault(user: JwtPayload, body: {
        context: string;
        reportId: number;
    }): Promise<{
        success: boolean;
        reportId: number;
    }>;
    clearUserDefault(user: JwtPayload, context: string): Promise<{
        success: boolean;
    }>;
    syncSystem(user: JwtPayload): Promise<{
        success: boolean;
        synced: number;
        message: string;
    }>;
}
export declare class ReportsByIdController {
    private readonly reports;
    private readonly execution;
    constructor(reports: ReportsService, execution: ReportExecutionService);
    byId(user: JwtPayload, id: number): Promise<{
        report: {
            User_Report_created_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            description: string | null;
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        report: {
            User_Report_created_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
            User_Report_modified_byToUser: {
                username: string;
                email: string;
                name: string | null;
                id: string;
                first_name: string | null;
                last_name: string | null;
            } | null;
        } & {
            description: string | null;
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            unique_name: string;
            report_config: import("@prisma/client/runtime/library").JsonValue;
            is_public: boolean;
            is_system: boolean;
            context: string | null;
        } & {
            created_at_formatted: string | null;
            modified_at_formatted: string | null;
        };
    }>;
    remove(user: JwtPayload, id: number): Promise<{
        success: boolean;
    }>;
    execute(user: JwtPayload, id: number, body: ExecuteReportDto): Promise<{
        data: Record<string, unknown>[];
        totalRecords: number;
        formulaWarnings?: import("./report-formula/types").FormulaWarningSummary[];
    }>;
    export(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        format: string;
        rows: Record<string, unknown>[];
        totalRecords: number;
        reportId: number;
    }>;
    listShares(user: JwtPayload, id: number): Promise<{
        shares: {
            id: number;
            created_at: Date;
            created_by: string | null;
            report_id: number;
            shared_with_user_id: string | null;
            shared_with_role: import(".prisma/client").$Enums.user_role | null;
            permission: string;
        }[];
    }>;
    share(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        id: number;
        created_at: Date;
        created_by: string | null;
        report_id: number;
        shared_with_user_id: string | null;
        shared_with_role: import(".prisma/client").$Enums.user_role | null;
        permission: string;
    }>;
    listSchedules(user: JwtPayload, id: number): Promise<{
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
    schedule(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
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
}
