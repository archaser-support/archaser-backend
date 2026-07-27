import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { PermissionsService } from "../permissions/permissions.service";
export declare class RolesService {
    private readonly db;
    private readonly accessScope;
    private readonly permissions;
    constructor(db: DatabaseService, accessScope: AccessScopeService, permissions: PermissionsService);
    private resolveTargetAccountId;
    listRoles(user: JwtPayload, accountIdQuery?: string): Promise<{
        roles: {
            role: string;
            permissionCount: number;
        }[];
    }>;
    getRole(user: JwtPayload, role: string, accountIdQuery?: string): Promise<{
        role: string;
        permissions: string[];
        permissionCount: number;
    }>;
    updateRole(user: JwtPayload, role: string, body: {
        permissions?: string[];
        accountId?: number;
    }, accountIdQuery?: string): Promise<{
        message: string;
        role: string;
        permissions: string[];
    }>;
}
