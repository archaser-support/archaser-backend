"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DualAuthGuard = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const jwt_2 = require("next-auth/jwt");
function sessionCookieName() {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "";
    const isSecure = process.env.NODE_ENV === "production" && baseUrl.startsWith("https://");
    const isStaging = (process.env.SERVICE_NAME || "").includes("staging") ||
        baseUrl.includes("staging.archaser.com");
    const prefix = isSecure ? "__Secure-" : "";
    const suffix = isStaging ? ".staging" : "";
    return `${prefix}next-auth.session-token.v1${suffix}`;
}
function authSecret(config) {
    return (config.get("NEXTAUTH_SECRET") ||
        config.get("JWT_SECRET") ||
        "archaser-stage0-dev-secret");
}
function expectedCronSecret(config) {
    return (config.get("CRON_SECRET") ||
        process.env.CRON_SECRET ||
        "b8638v2eQ7XBL7J3ILNQiFZHVvCAVB3i");
}
function extractCronSecret(req) {
    const header = req.headers["x-cron-secret"];
    if (typeof header === "string" && header.trim()) {
        return header.trim();
    }
    if (Array.isArray(header) && typeof header[0] === "string" && header[0].trim()) {
        return header[0].trim();
    }
    const query = req.query;
    for (const key of ["secret", "cronSecret"]) {
        const v = query?.[key];
        if (typeof v === "string" && v.trim())
            return v.trim();
        if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) {
            return v[0].trim();
        }
    }
    return null;
}
function isSystemCronPath(req) {
    const url = (req.originalUrl || req.url || "").split("?")[0];
    return (url === "/api/system/cron" ||
        url.endsWith("/api/system/cron") ||
        url === "/system/cron");
}
/**
 * Accept Nest Bearer JWT or existing NextAuth session cookie.
 * When Bearer is used, inject a NextAuth-compatible cookie so legacy
 * pages/api handlers that call getToken continue to work.
 */
let DualAuthGuard = class DualAuthGuard {
    constructor(jwtService, configService) {
        this.jwtService = jwtService;
        this.configService = configService;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
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
                const payload = await this.jwtService.verifyAsync(bearer);
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
            }
            catch {
                // fall through to cookie
            }
        }
        const cookieToken = await (0, jwt_2.getToken)({
            req: req,
            secret,
            cookieName: sessionCookieName(),
        });
        if (cookieToken) {
            const id = cookieToken.id ||
                cookieToken.sub;
            if (!id) {
                throw new common_1.UnauthorizedException("Invalid session token");
            }
            req.user = {
                sub: id,
                username: String(cookieToken.username || cookieToken.email || id),
                email: cookieToken.email ?? null,
                account_id: cookieToken.account_id ?? null,
                role: cookieToken.role ?? null,
                name: cookieToken.name ?? null,
            };
            req.authSource = "cookie";
            return true;
        }
        throw new common_1.UnauthorizedException("Missing or invalid authentication");
    }
    extractBearer(req) {
        const header = req.headers.authorization;
        if (header?.startsWith("Bearer ")) {
            return header.slice("Bearer ".length).trim() || null;
        }
        // EventSource cannot set Authorization; Amplify UI passes Nest JWT here.
        const query = req.query;
        const fromQuery = query?.access_token;
        if (typeof fromQuery === "string" && fromQuery.trim()) {
            return fromQuery.trim();
        }
        if (Array.isArray(fromQuery) && typeof fromQuery[0] === "string") {
            return fromQuery[0].trim() || null;
        }
        return null;
    }
    async injectNextAuthCookie(req, user, secret) {
        const cookieName = sessionCookieName();
        const encoded = await (0, jwt_2.encode)({
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
            req.cookies = {};
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
};
exports.DualAuthGuard = DualAuthGuard;
exports.DualAuthGuard = DualAuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [jwt_1.JwtService,
        config_1.ConfigService])
], DualAuthGuard);
