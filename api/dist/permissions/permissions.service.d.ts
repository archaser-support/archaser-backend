import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
export declare const ALL_PERMISSION_KEYS: string[];
export declare class PermissionsService {
    private readonly db;
    private readonly accessScope;
    constructor(db: DatabaseService, accessScope: AccessScopeService);
    getAllPermissionKeys(): string[];
    getPermissionsByCategory(): Record<string, Record<string, string[]>>;
    getMyPermissions(user: JwtPayload): Promise<{
        permissions: string[];
    }>;
    getPermissionsMatrix(user: JwtPayload, accountIdQuery?: string): Promise<{
        permissions: string[];
        permissionsByCategory: Record<string, Record<string, string[]>>;
    }>;
    getPermissionsForRole(user: JwtPayload, role: string, accountIdQuery?: string): Promise<{
        role: string;
        permissions: string[];
    }>;
    putPermissionsForRole(user: JwtPayload, role: string, body: {
        permissions?: string[];
        accountId?: number;
    }, accountIdQuery?: string): Promise<{
        message: string;
        role: string;
        permissions: string[];
    }>;
    getRolePermissions(accountId: number, role: string): Promise<string[]>;
    updateRolePermissions(accountId: number, role: string, permissions: string[], userId: string): Promise<void>;
    private filterCategoryKeys;
}
