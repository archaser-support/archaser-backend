import { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { JwtPayload } from "./auth.service";
export type DualAuthRequest = Request & {
    user?: JwtPayload;
    authSource?: "bearer" | "cookie";
};
export declare class DualAuthGuard implements CanActivate {
    private readonly jwtService;
    private readonly configService;
    constructor(jwtService: JwtService, configService: ConfigService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private extractBearer;
    private injectNextAuthCookie;
}
