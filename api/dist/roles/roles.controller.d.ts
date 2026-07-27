import { JwtPayload } from "../auth/auth.service";
import { RolesService } from "./roles.service";
export declare class RolesController {
    private readonly roles;
    constructor(roles: RolesService);
    list(user: JwtPayload, accountId?: string): Promise<{
        roles: {
            role: string;
            permissionCount: number;
        }[];
    }>;
    getRole(user: JwtPayload, role: string, accountId?: string): Promise<{
        role: string;
        permissions: string[];
        permissionCount: number;
    }>;
    updateRole(user: JwtPayload, role: string, body: {
        permissions?: string[];
        accountId?: number;
    }, accountId?: string): Promise<{
        message: string;
        role: string;
        permissions: string[];
    }>;
}
