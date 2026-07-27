import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare const ACCOUNT_ADMIN_ENTITY_TYPES: readonly ["accounts", "users", "business-units", "bank-accounts", "customer-banks", "business-unit-banks"];
export type AccountAdminEntityType = (typeof ACCOUNT_ADMIN_ENTITY_TYPES)[number];
export type AccountAdminListQuery = {
    page?: string;
    limit?: string;
    search?: string;
};
export declare class AccountAdminEntitiesService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    private delegate;
    parseId(entityType: AccountAdminEntityType, raw: string): number | string;
    private scope;
    list(entityType: AccountAdminEntityType, user: JwtPayload, query: AccountAdminListQuery): Promise<({
        Parent: {
            account_id: number;
            name: string;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.record_status;
            created_by: string | null;
            modified_by: string | null;
            parent_id: number | null;
            external_id: string | null;
            is_primary: boolean;
        } | null;
    } & {
        account_id: number;
        name: string;
        id: number;
        created_at: Date;
        modified_at: Date;
        status: import(".prisma/client").$Enums.record_status;
        created_by: string | null;
        modified_by: string | null;
        parent_id: number | null;
        external_id: string | null;
        is_primary: boolean;
    })[] | {
        data: any;
        total: any;
    } | {
        data: any;
        totalRecords: any;
        page: number;
        limit: number;
    } | {
        users: any;
        total: any;
        page: number;
        limit: number;
    } | {
        [x: string]: any;
        totalRecords: any;
        page: number;
        limit: number;
    }>;
    private listBusinessUnitsDropdown;
    private sortBusinessUnitsHierarchically;
    getById(entityType: AccountAdminEntityType, user: JwtPayload, id: number | string): Promise<any>;
    update(entityType: AccountAdminEntityType, user: JwtPayload, id: number | string, body: Record<string, unknown>): Promise<any>;
    listCollectionAgents(user: JwtPayload): Promise<{
        name: string;
        businessUnitName: string | null;
        username: string;
        email: string;
        role: import(".prisma/client").$Enums.user_role | null;
        id: string;
        status: import(".prisma/client").$Enums.record_status;
        first_name: string | null;
        last_name: string | null;
        business_unit_id: number | null;
        BusinessUnit: {
            name: string;
            id: number;
        } | null;
    }[]>;
}
