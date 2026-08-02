import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class ImportService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    importLeaf(leaf: string, user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    createJob(user: JwtPayload, body: Record<string, unknown>): Promise<{
        id: string;
        account_id: number;
        user_id: string | null;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        total_records: number;
        processed_records: number;
        successful_records: number;
        failed_records: number;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
    }>;
    completeJob(user: JwtPayload, body: Record<string, unknown>): Promise<{
        id: string;
        account_id: number;
        user_id: string | null;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        total_records: number;
        processed_records: number;
        successful_records: number;
        failed_records: number;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
    }>;
    getJobById(user: JwtPayload, jobId: string): Promise<{
        ImportRecord: {
            id: string;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.ImportRecordStatus;
            created_by: string | null;
            modified_by: string | null;
            import_job_id: string;
            row_index: number;
            original_data: import("@prisma/client/runtime/library").JsonValue;
            processed_data: import("@prisma/client/runtime/library").JsonValue | null;
            validation_errors: import("@prisma/client/runtime/library").JsonValue | null;
            processing_errors: import("@prisma/client/runtime/library").JsonValue | null;
            result_message: string | null;
            entity_id: number | null;
        }[];
    } & {
        id: string;
        account_id: number;
        user_id: string | null;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        total_records: number;
        processed_records: number;
        successful_records: number;
        failed_records: number;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
    }>;
}
