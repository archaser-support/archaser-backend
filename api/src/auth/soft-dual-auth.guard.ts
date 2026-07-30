import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { DualAuthGuard, DualAuthRequest } from "./dual-auth.guard";

/**
 * Paths under /api that must stay reachable without Nest JWT/cookie
 * (webhooks, public portal-adjacent, NextAuth, tracking pixels).
 * Legacy handlers still enforce their own rules.
 */
export function isPublicPagesApiPath(urlPath: string): boolean {
    const path = urlPath.split("?")[0];
    const prefixes = [
        "/api/email/",
        "/api/sms/webhook/",
        "/api/auth/",
        "/api/portal/",
        "/api/contact-response",
        "/api/metrics",
        "/api/errors/",
    ];
    if (prefixes.some((p) => path === p.slice(0, -1) || path.startsWith(p))) {
        return true;
    }
    // Public customer portal UUID leaves (also owned by PortalCustomers controller)
    if (/^\/api\/customers\/[^/]+\/(portal-data|agent-portal|invoices|bank-details|banks|disputes|create-dispute|view-disputes|wrong-contact)(\/|$)/.test(path)) {
        return true;
    }
    return false;
}

/**
 * Prefer DualAuth (Bearer → cookie injection). If missing auth on a public
 * path, allow through so webhooks/NextAuth keep working.
 */
@Injectable()
export class SoftDualAuthGuard implements CanActivate {
    constructor(private readonly dualAuth: DualAuthGuard) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<DualAuthRequest>();
        const urlPath = req.originalUrl || req.url || "";
        try {
            return await this.dualAuth.canActivate(context);
        } catch (error) {
            if (isPublicPagesApiPath(urlPath.split("?")[0])) {
                return true;
            }
            if (error instanceof UnauthorizedException) {
                throw error;
            }
            throw new UnauthorizedException("Missing or invalid authentication");
        }
    }
}
