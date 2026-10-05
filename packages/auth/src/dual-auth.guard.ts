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

type ViewAsClaims = Pick<
    JwtPayload,
    | "view_as_user_id"
    | "view_as_user_role"
    | "view_as_user_account_id"
    | "view_as_user_name"
    | "view_as_user_account_name"
>;

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

function viewAsFromToken(token: Record<string, unknown> | null): ViewAsClaims {
    if (!token) {
        return {};
    }
    const viewAsId = token.view_as_user_id;
    if (typeof viewAsId !== "string" || !viewAsId.trim()) {
        return {};
    }
    const accountId = token.view_as_user_account_id;
    return {
        view_as_user_id: viewAsId.trim(),
        view_as_user_role:
            typeof token.view_as_user_role === "string"
                ? token.view_as_user_role
                : null,
        view_as_user_account_id:
            typeof accountId === "number" ? accountId : null,
        view_as_user_name:
            typeof token.view_as_user_name === "string"
                ? token.view_as_user_name
                : null,
        view_as_user_account_name:
            typeof token.view_as_user_account_name === "string"
                ? token.view_as_user_account_name
                : null,
    };
}

function viewAsFromPayload(payload: JwtPayload): ViewAsClaims {
    if (!payload.view_as_user_id?.trim()) {
        return {};
    }
    return {
        view_as_user_id: payload.view_as_user_id.trim(),
        view_as_user_role: payload.view_as_user_role ?? null,
        view_as_user_account_id: payload.view_as_user_account_id ?? null,
        view_as_user_name: payload.view_as_user_name ?? null,
        view_as_user_account_name: payload.view_as_user_account_name ?? null,
    };
}

function viewAsFromQuery(req: Request): ViewAsClaims {
    const query = req.query as Record<string, string | string[] | undefined>;
    const rawId = query.view_as_user_id;
    const viewAsId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (typeof viewAsId !== "string" || !viewAsId.trim()) {
        return {};
    }
    const roleRaw = query.view_as_user_role;
    const accountRaw = query.view_as_user_account_id;
    const nameRaw = query.view_as_user_name;
    const accountNameRaw = query.view_as_user_account_name;
    const role = Array.isArray(roleRaw) ? roleRaw[0] : roleRaw;
    const accountStr = Array.isArray(accountRaw) ? accountRaw[0] : accountRaw;
    const accountId =
        typeof accountStr === "string" && accountStr.trim()
            ? Number(accountStr)
            : NaN;
    const name = Array.isArray(nameRaw) ? nameRaw[0] : nameRaw;
    const accountName = Array.isArray(accountNameRaw)
        ? accountNameRaw[0]
        : accountNameRaw;
    return {
        view_as_user_id: viewAsId.trim(),
        view_as_user_role: typeof role === "string" ? role : null,
        view_as_user_account_id: Number.isFinite(accountId) ? accountId : null,
        view_as_user_name: typeof name === "string" ? name : null,
        view_as_user_account_name:
            typeof accountName === "string" ? accountName : null,
    };
}

function viewAsFromHeaders(req: Request): ViewAsClaims {
    const idHeader = req.headers["x-archaser-view-as-user-id"];
    const viewAsId = Array.isArray(idHeader) ? idHeader[0] : idHeader;
    if (typeof viewAsId !== "string" || !viewAsId.trim()) {
        return {};
    }
    const roleHeader = req.headers["x-archaser-view-as-user-role"];
    const accountHeader = req.headers["x-archaser-view-as-user-account-id"];
    const nameHeader = req.headers["x-archaser-view-as-user-name"];
    const accountNameHeader =
        req.headers["x-archaser-view-as-user-account-name"];
    const role = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;
    const accountRaw = Array.isArray(accountHeader)
        ? accountHeader[0]
        : accountHeader;
    const accountId =
        typeof accountRaw === "string" && accountRaw.trim()
            ? Number(accountRaw)
            : NaN;
    const name = Array.isArray(nameHeader) ? nameHeader[0] : nameHeader;
    const accountName = Array.isArray(accountNameHeader)
        ? accountNameHeader[0]
        : accountNameHeader;
    return {
        view_as_user_id: viewAsId.trim(),
        view_as_user_role: typeof role === "string" ? role : null,
        view_as_user_account_id: Number.isFinite(accountId) ? accountId : null,
        view_as_user_name: typeof name === "string" ? name : null,
        view_as_user_account_name:
            typeof accountName === "string" ? accountName : null,
    };
}

/**
 * Accept Nest Bearer JWT or existing NextAuth session cookie.
 * When Bearer is used, inject a NextAuth-compatible cookie so legacy
 * pages/api handlers that call getToken continue to work.
 * View-as: NextAuth cookie (same-origin) or X-Archaser-View-As-* headers
 * (Amplify cross-origin Bearer) merged onto the logged-in identity.
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
        const cookieToken = await getToken({
            req: req as Parameters<typeof getToken>[0]["req"],
            secret,
            cookieName: sessionCookieName(),
        });
        const cookieViewAs = viewAsFromToken(
            cookieToken as Record<string, unknown> | null
        );
        const headerViewAs = {
            ...viewAsFromQuery(req),
            ...viewAsFromHeaders(req),
        };

        const bearer = this.extractBearer(req);
        if (bearer) {
            try {
                const payload = await this.jwtService.verifyAsync<JwtPayload>(
                    bearer
                );
                const bearerViewAs = viewAsFromPayload(payload);
                const cookieSameUser =
                    cookieToken &&
                    ((cookieToken.id as string | undefined) ||
                        (cookieToken.sub as string | undefined)) === payload.sub;
                req.user = {
                    sub: payload.sub,
                    username: payload.username,
                    email: payload.email ?? null,
                    account_id: payload.account_id ?? null,
                    role: payload.role ?? null,
                    name: payload.name ?? null,
                    ...headerViewAs,
                    ...(cookieSameUser ? cookieViewAs : {}),
                    ...bearerViewAs,
                };
                req.authSource = "bearer";
                await this.injectNextAuthCookie(req, req.user, secret);
                return true;
            } catch {
                // fall through to cookie
            }
        }

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
                ...headerViewAs,
                ...cookieViewAs,
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
                view_as_user_id: user.view_as_user_id ?? undefined,
                view_as_user_role: user.view_as_user_role ?? undefined,
                view_as_user_account_id: user.view_as_user_account_id ?? undefined,
                view_as_user_name: user.view_as_user_name ?? undefined,
                view_as_user_account_name:
                    user.view_as_user_account_name ?? undefined,
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
            .map((c: string) => c.trim())
            .filter((c: string) => c && !c.startsWith(`${cookieName}=`))
            .join("; ");
        req.headers.cookie = without
            ? `${without}; ${cookieName}=${encoded}`
            : `${cookieName}=${encoded}`;
    }
}
