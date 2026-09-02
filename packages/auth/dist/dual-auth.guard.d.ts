import { CanActivate, ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { JwtPayload } from "./jwt-payload";
export type DualAuthRequest = Request & {
    user?: JwtPayload;
    authSource?: "bearer" | "cookie";
};
/**
 * Accept Nest Bearer JWT or existing NextAuth session cookie.
 * When Bearer is used, inject a NextAuth-compatible cookie so legacy
 * pages/api handlers that call getToken continue to work.
 */
export declare class DualAuthGuard implements CanActivate {
    private readonly jwtService;
    private readonly configService;
    constructor(jwtService: JwtService, configService: ConfigService);
    canActivate(context: ExecutionContext): Promise<boolean>;
    private extractBearer;
    private injectNextAuthCookie;
}
