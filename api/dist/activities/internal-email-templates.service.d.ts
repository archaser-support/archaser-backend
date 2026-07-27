import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class InternalEmailTemplatesService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private accountId;
    list(user: JwtPayload): Promise<{
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    }[]>;
    listMaster(type?: string): Promise<{
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    } | {
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    }[]>;
    getById(user: JwtPayload, id: number): Promise<{
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    }>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        type: import(".prisma/client").$Enums.internal_email_template_type;
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        created_by: string | null;
        modified_by: string | null;
        subject: string;
        content: string;
        active: boolean;
        master_template: boolean;
    }>;
    delete(user: JwtPayload, id: number): Promise<null>;
    testEmail(user: JwtPayload, id: number, body: {
        emailSubject?: string;
        emailContent?: string;
    }): Promise<{
        success: boolean;
        dryRun: boolean;
        message: string;
        templateId: number;
        subject: string;
    }>;
}
