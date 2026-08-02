import { AccessScopeService } from "../auth/access-scope.service";
import { DualAuthRequest } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class LogsController {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    list(user: JwtPayload, query: Record<string, string | undefined>): Promise<{
        logs: {
            id: bigint;
            timestamp: Date;
            level: import(".prisma/client").$Enums.log_level;
            message: string;
            source: string;
            details: import("@prisma/client/runtime/library").JsonValue | null;
            account_id: number | null;
            user_id: string | null;
            job_id: number | null;
            correlation_id: string | null;
            sub_source: string | null;
        }[];
        totalRecords: number;
        page: number;
        limit: number;
        accountId: number;
    } | {
        sources: string[];
    }>;
    create(body: Record<string, unknown>, req: DualAuthRequest): Promise<{
        error: string;
        errors: string[];
        success?: undefined;
    } | {
        error: string;
        errors?: undefined;
        success?: undefined;
    } | {
        success: boolean;
        error?: undefined;
        errors?: undefined;
    }>;
}
