import { JwtPayload } from "../auth/auth.service";
import { ImportService } from "./import.service";
export declare class ImportDomainController {
    private readonly importService;
    constructor(importService: ImportService);
    payment(user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    customer(user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    contact(user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    invoice(user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    policy(user: JwtPayload, body: Record<string, unknown>): Promise<{
        results: never[];
        message: string;
    }>;
    jobCreate(user: JwtPayload, body: Record<string, unknown>): Promise<{
        account_id: number;
        id: string;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        user_id: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        total_records: number;
        processed_records: number;
        successful_records: number;
        failed_records: number;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
    }>;
    jobComplete(user: JwtPayload, body: Record<string, unknown>): Promise<{
        account_id: number;
        id: string;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        user_id: string | null;
        metadata: import("@prisma/client/runtime/library").JsonValue | null;
        total_records: number;
        processed_records: number;
        successful_records: number;
        failed_records: number;
        started_at: Date | null;
        completed_at: Date | null;
        error_message: string | null;
    }>;
    jobById(jobId: string, user: JwtPayload): Promise<{
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
        account_id: number;
        id: string;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.ImportStatus;
        created_by: string | null;
        modified_by: string | null;
        import_type: import(".prisma/client").$Enums.ImportType;
        user_id: string | null;
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
