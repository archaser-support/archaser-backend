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
import { JwtPayload } from "./jwt-payload";

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

function expectedCronSecret(config: ConfigService): string {
    return (
        config.get<string>("CRON_SECRET") ||
        process.env.CRON_SECRET ||
        "b8638v2eQ7XBL7J3ILNQiFZHVvCAVB3i"
    );
}

function extractCronSecret(req: Request): string | null {
    const header = req.headers["x-cron-secret"];
    if (typeof header === "string" && header.trim()) {
        return header.trim();
    }
    if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) {
        return header[0].trim();
    }
    const query = req.query as { secret?: string | string[]; cronSecret?: string | string[] };
    for (const key of ["secret", "cronSecret"] as const) {
        const v = query?.[key];
        if (typeof v === "string" && v.trim()) return v.trim();
        if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) {
            return v[0].trim();
        }
    }
    return null;
}

function isSystemCronPath(req: Request): boolean {
    const url = (req.originalUrl || req.url || "").split("?")[0];
    return (
        url === "/api/system/cron" ||
        url.endsWith("/api/system/cron") ||
        url === "/system/cron"
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

        // Lambda cron tick: allow x-cron-secret (or ?secret=) without JWT.
        if (isSystemCronPath(req)) {
            const cronSecret = extractCronSecret(req);
            if (cronSecret && cronSecret === expectedCronSecret(this.configService)) {
                req.user = {
                    sub: "cron-lambda",
                    username: "cron-lambda",
                    email: null,
                    account_id: 10013,
                    role: "archaser_admin",
                    name: "Cron Lambda",
                };
                req.authSource = "bearer";
                return true;
            }
        }

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
        if (header?.startsWith("Bearer ")) {
            return header.slice("Bearer ".length).trim() || null;
        }
        // EventSource cannot set Authorization; Amplify UI passes Nest JWT here.
        const query = req.query as { access_token?: string | string[] };
        const fromQuery = query?.access_token;
        if (typeof fromQuery === "string" && fromQuery.trim()) {
            return fromQuery.trim();
        }
        if (Array.isArray(fromQuery) && typeof fromQuery[0] === "string") {
            return fromQuery[0].trim() || null;
        }
        return null;
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
