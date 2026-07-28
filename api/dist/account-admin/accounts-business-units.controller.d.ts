import { JwtPayload } from "../auth/auth.service";
import { AccountAdminEntitiesService, AccountAdminListQuery } from "./account-admin-entities.service";
export declare class AccountsBusinessUnitsController {
    private readonly service;
    constructor(service: AccountAdminEntitiesService);
    list(user: JwtPayload, accountId: number, query: AccountAdminListQuery): Promise<({
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
        User_BusinessUnit_created_byToUser: {
            email: string;
            name: string | null;
            id: string;
        } | null;
        User_BusinessUnit_modified_byToUser: {
            email: string;
            name: string | null;
            id: string;
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
        data: ({
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
            User_BusinessUnit_created_byToUser: {
                email: string;
                name: string | null;
                id: string;
            } | null;
            User_BusinessUnit_modified_byToUser: {
                email: string;
                name: string | null;
                id: string;
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
        })[];
        total: number;
    }>;
}
