import {
    CanActivate,
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { encode, getToken } from "next-auth/jwt";
import { Request } from "express";
import { JwtPayload } from "./auth.service";

export type DualAuthRequest = Request & {
    user?: JwtPayload;
    authSource?: "bearer" | "cookie";
};

function sessionCookieName(): string {
    const baseUrl =
        process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "";
    const isSecure =
        process.env.NODE_ENV === "production" && baseUrl.startsWith("https://");
    const isStaging =
        (process.env.SERVICE_NAME || "").includes("staging") ||
        baseUrl.includes("staging.archaser.com");
    const prefix = isSecure ? "__Secure-" : "";
    const suffix = isStaging ? ".staging" : "";
    return `${prefix}next-auth.session-token.v1${suffix}`;
}

function authSecret(config: ConfigService): string {
    return (
        config.get<string>("NEXTAUTH_SECRET") ||
        config.get<string>("JWT_SECRET") ||
        "archaser-stage0-dev-secret"
    );
}

/**
 * Accept Nest Bearer JWT or existing NextAuth session cookie.
 * When Bearer is used, inject a NextAuth-compatible cookie so legacy
 * pages/api handlers that call getToken continue to work.
 */
@Injectable()
export class DualAuthGuard implements CanActivate {
    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const req = context.switchToHttp().getRequest<DualAuthRequest>();
        const secret = authSecret(this.configService);

        const bearer = this.extractBearer(req);
        if (bearer) {
            try {
                const payload = await this.jwtService.verifyAsync<JwtPayload>(
                    bearer
                );
                req.user = {
                    sub: payload.sub,
                    username: payload.username,
                    email: payload.email ?? null,
                    account_id: payload.account_id ?? null,
                    role: payload.role ?? null,
                    name: payload.name ?? null,
                };
                req.authSource = "bearer";
                await this.injectNextAuthCookie(req, req.user, secret);
                return true;
            } catch {
                // fall through to cookie
            }
        }

        const cookieToken = await getToken({
            req: req as Parameters<typeof getToken>[0]["req"],
            secret,
            cookieName: sessionCookieName(),
        });

        if (cookieToken) {
            const id =
                (cookieToken.id as string | undefined) ||
                (cookieToken.sub as string | undefined);
            if (!id) {
                throw new UnauthorizedException("Invalid session token");
            }
            req.user = {
                sub: id,
                username: String(cookieToken.username || cookieToken.email || id),
                email: (cookieToken.email as string | null) ?? null,
                account_id: (cookieToken.account_id as number | null) ?? null,
                role: (cookieToken.role as string | null) ?? null,
                name: (cookieToken.name as string | null) ?? null,
            };
            req.authSource = "cookie";
            return true;
        }

        throw new UnauthorizedException("Missing or invalid authentication");
    }

    private extractBearer(req: Request): string | null {
        const header = req.headers.authorization;
        if (!header?.startsWith("Bearer ")) {
            return null;
        }
        return header.slice("Bearer ".length).trim() || null;
    }

    private async injectNextAuthCookie(
        req: DualAuthRequest,
        user: JwtPayload,
        secret: string
    ): Promise<void> {
        const cookieName = sessionCookieName();
        const encoded = await encode({
            token: {
                id: user.sub,
                sub: user.sub,
                username: user.username,
                email: user.email,
                account_id: user.account_id,
                role: user.role,
                name: user.name,
            },
            secret,
        });
        if (!req.cookies) {
            (req as { cookies: Record<string, string> }).cookies = {};
        }
        req.cookies[cookieName] = encoded;
        const existing = req.headers.cookie || "";
        const without = existing
            .split(";")
            .map((c) => c.trim())
            .filter((c) => c && !c.startsWith(`${cookieName}=`))
            .join("; ");
        req.headers.cookie = without
            ? `${without}; ${cookieName}=${encoded}`
            : `${cookieName}=${encoded}`;
    }
}
