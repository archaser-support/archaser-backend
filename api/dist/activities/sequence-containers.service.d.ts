import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare class SequenceContainersService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private ctx;
    private assertManage;
    list(user: JwtPayload, category: string, includeInactive: boolean): Promise<{
        data: ({
            _count: {
                ActivitiesSequence: number;
            };
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            active: boolean;
            category: import(".prisma/client").$Enums.category;
            master_template: boolean;
            is_deleted: boolean;
        })[];
    }>;
    getById(user: JwtPayload, id: number): Promise<{
        data: {
            _count: {
                ActivitiesSequence: number;
            };
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            active: boolean;
            category: import(".prisma/client").$Enums.category;
            master_template: boolean;
            is_deleted: boolean;
        };
    }>;
    getUsage(user: JwtPayload, id: number): Promise<{
        data: {
            connectedCustomers: {
                id: number;
                customer_number: string | null;
            }[];
            totalCount: number;
        };
    }>;
    create(user: JwtPayload, body: Record<string, unknown>): Promise<{
        data: {
            _count: {
                ActivitiesSequence: number;
            };
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            active: boolean;
            category: import(".prisma/client").$Enums.category;
            master_template: boolean;
            is_deleted: boolean;
        };
    }>;
    update(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        data: {
            _count: {
                ActivitiesSequence: number;
            };
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            active: boolean;
            category: import(".prisma/client").$Enums.category;
            master_template: boolean;
            is_deleted: boolean;
        };
    }>;
    delete(user: JwtPayload, id: number): Promise<{
        message: string;
        details: {
            deletedSequences: number;
            affectedActivities: number;
            affectedCustomers: number;
        };
    }>;
    postAction(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
        data: {
            _count: {
                ActivitiesSequence: number;
            };
        } & {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            is_default: boolean;
            active: boolean;
            category: import(".prisma/client").$Enums.category;
            master_template: boolean;
            is_deleted: boolean;
        };
        message: string;
    } | {
        message: string;
        details: {
            migratedCustomers: number;
            deletedSequences: number;
            affectedActivities: number;
        };
    }>;
    private clone;
    private setDefault;
    private deleteWithReplacement;
    private softDelete;
}
