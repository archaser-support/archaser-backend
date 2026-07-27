import { JwtPayload } from "../auth/auth.service";
import { PermissionsService } from "./permissions.service";
export declare class PermissionsController {
    private readonly permissionsService;
    constructor(permissionsService: PermissionsService);
    me(user: JwtPayload): Promise<{
        permissions: string[];
    }>;
    list(user: JwtPayload, accountId?: string): Promise<{
        permissions: string[];
        permissionsByCategory: Record<string, Record<string, string[]>>;
    }>;
    getRole(user: JwtPayload, role: string, accountId?: string): Promise<{
        role: string;
        permissions: string[];
    }>;
    putRole(user: JwtPayload, role: string, body: {
        permissions?: string[];
        accountId?: number;
    }, accountId?: string): Promise<{
        message: string;
        role: string;
        permissions: string[];
    }>;
}
