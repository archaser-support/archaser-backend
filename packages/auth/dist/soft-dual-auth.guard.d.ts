import { CanActivate, ExecutionContext } from "@nestjs/common";
import { DualAuthGuard } from "./dual-auth.guard";
/**
 * Paths under /api that must stay reachable without Nest JWT/cookie
 * (webhooks, public portal-adjacent, NextAuth, tracking pixels).
 * Legacy handlers still enforce their own rules.
 */
export declare function isPublicPagesApiPath(urlPath: string): boolean;
/**
 * Prefer DualAuth (Bearer → cookie injection). If missing auth on a public
 * path, allow through so webhooks/NextAuth keep working.
 */
export declare class SoftDualAuthGuard implements CanActivate {
    private readonly dualAuth;
    constructor(dualAuth: DualAuthGuard);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
