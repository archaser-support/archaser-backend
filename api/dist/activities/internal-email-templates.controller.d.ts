import { JwtPayload } from "../auth/auth.service";
import { InternalEmailTemplatesService } from "./internal-email-templates.service";
export declare class InternalEmailTemplatesController {
    private readonly templates;
    constructor(templates: InternalEmailTemplatesService);
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
    master(_user: JwtPayload, type?: string): Promise<{
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
    remove(user: JwtPayload, id: number): Promise<void>;
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
