import { JwtPayload } from "../auth/auth.service";
import { SequenceContainersService } from "./sequence-containers.service";
export declare class SequenceContainersController {
    private readonly containers;
    constructor(containers: SequenceContainersService);
    list(user: JwtPayload, category: string, includeInactive?: string): Promise<{
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
    getById(user: JwtPayload, id: number, usage?: string): Promise<{
        data: {
            connectedCustomers: {
                id: number;
                customer_number: string | null;
            }[];
            totalCount: number;
        };
    } | {
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
    remove(user: JwtPayload, id: number): Promise<{
        message: string;
        details: {
            deletedSequences: number;
            affectedActivities: number;
            affectedCustomers: number;
        };
    }>;
    action(user: JwtPayload, id: number, body: Record<string, unknown>): Promise<{
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
}
