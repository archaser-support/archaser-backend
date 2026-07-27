import { CanActivate, ExecutionContext } from "@nestjs/common";
import { DualAuthGuard } from "./dual-auth.guard";
export declare function isPublicPagesApiPath(urlPath: string): boolean;
export declare class SoftDualAuthGuard implements CanActivate {
    private readonly dualAuth;
    constructor(dualAuth: DualAuthGuard);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
