"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcryptjs"));
const database_service_1 = require("../database/database.service");
let AuthService = class AuthService {
    constructor(database, jwtService, configService) {
        this.database = database;
        this.jwtService = jwtService;
        this.configService = configService;
    }
    async login(credentials) {
        const user = await this.database.user.findFirst({
            where: {
                username: credentials.username,
                deactivated_at: null,
            },
            select: {
                id: true,
                username: true,
                email: true,
                name: true,
                password: true,
                account_id: true,
                role: true,
                freeze: true,
                status: true,
                failed_login_attempts: true,
                language: true,
                time_zone: true,
                locale: true,
                sidebar_collapsed: true,
            },
        });
        if (!user?.password) {
            throw new common_1.UnauthorizedException("Invalid credentials");
        }
        if (user.freeze === true) {
            throw new common_1.UnauthorizedException("Your account has been frozen due to multiple failed login attempts. Please contact an administrator.");
        }
        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) {
            const currentAttempts = user.failed_login_attempts || 0;
            const newAttemptCount = currentAttempts + 1;
            const shouldFreeze = newAttemptCount >= 5;
            await this.database.user.update({
                where: { id: user.id },
                data: {
                    failed_login_attempts: newAttemptCount,
                    last_failed_login_at: new Date(),
                    ...(shouldFreeze ? { freeze: true } : {}),
                },
            });
            throw new common_1.UnauthorizedException("Invalid credentials");
        }
        if ((user.failed_login_attempts || 0) > 0) {
            await this.database.user.update({
                where: { id: user.id },
                data: { failed_login_attempts: 0 },
            });
        }
        if (user.status === "Inactive") {
            throw new common_1.UnauthorizedException("Your account is currently inactive. Please contact support.");
        }
        const account = user.account_id
            ? await this.database.account.findUnique({
                where: { id: user.account_id },
                select: {
                    name: true,
                    primary_color: true,
                    secondary_color: true,
                },
            })
            : null;
        return this.issueTokenResponse({
            sub: user.id,
            username: user.username,
            email: user.email,
            account_id: user.account_id,
            role: user.role,
            name: user.name,
            language: user.language ?? "English",
            timezone: user.time_zone ?? null,
            locale: user.locale ?? null,
            account_name: account?.name ?? null,
            primary_color: account?.primary_color ?? null,
            secondary_color: account?.secondary_color ?? null,
            sidebar_collapsed: user.sidebar_collapsed ?? null,
        });
    }
    async getProfile(user) {
        const dbUser = await this.database.user.findFirst({
            where: { id: user.sub, deactivated_at: null },
            select: {
                id: true,
                username: true,
                email: true,
                name: true,
                account_id: true,
                role: true,
                language: true,
                time_zone: true,
                locale: true,
                sidebar_collapsed: true,
            },
        });
        if (!dbUser) {
            throw new common_1.UnauthorizedException("User not found");
        }
        const account = dbUser.account_id
            ? await this.database.account.findUnique({
                where: { id: dbUser.account_id },
                select: {
                    name: true,
                    primary_color: true,
                    secondary_color: true,
                },
            })
            : null;
        return {
            sub: dbUser.id,
            username: dbUser.username,
            email: dbUser.email ?? null,
            account_id: dbUser.account_id ?? null,
            role: dbUser.role ?? null,
            name: dbUser.name ?? null,
            language: dbUser.language ?? "English",
            timezone: dbUser.time_zone ?? null,
            locale: dbUser.locale ?? null,
            account_name: account?.name ?? null,
            primary_color: account?.primary_color ?? null,
            secondary_color: account?.secondary_color ?? null,
            sidebar_collapsed: dbUser.sidebar_collapsed ?? null,
        };
    }
    async requestPasswordReset(email, language) {
        const user = await this.database.user.findFirst({
            where: { email },
        });
        if (!user) {
            throw new common_1.NotFoundException("User not found");
        }
        const crypto = await Promise.resolve().then(() => __importStar(require("crypto")));
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000);
        await this.database.user.update({
            where: { id: user.id },
            data: { resetToken, resetTokenExpiry },
        });
        const frontendBase = this.configService.get("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000";
        const origin = frontendBase.replace(/\/login\/?$/, "").replace(/\/$/, "");
        const resetLink = `${origin}/reset-password/${resetToken}`;
        await this.sendResetPasswordEmail(email, resetLink, language);
        return { message: "Reset link sent to your email" };
    }
    async resetPassword(token, password) {
        const errors = this.validatePasswordComplexity(password);
        if (errors.length > 0) {
            throw new common_1.BadRequestException(errors.join(", "));
        }
        const user = await this.database.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: { gt: new Date() },
            },
        });
        if (!user) {
            throw new common_1.BadRequestException("Invalid or expired token");
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await this.database.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetToken: null,
                resetTokenExpiry: null,
                session_version: { increment: 1 },
            },
        });
        return {
            message: "Password reset successfully. All existing sessions have been invalidated.",
        };
    }
    validatePasswordComplexity(password) {
        const errors = [];
        if (!password || password.length < 8) {
            errors.push("Password must be at least 8 characters");
        }
        if (!/(?=.*[a-z])/.test(password)) {
            errors.push("Password must include a lowercase letter");
        }
        if (!/(?=.*[A-Z])/.test(password)) {
            errors.push("Password must include an uppercase letter");
        }
        if (!/(?=.*\d)/.test(password)) {
            errors.push("Password must include a number");
        }
        return errors;
    }
    async sendResetPasswordEmail(email, resetLink, _language) {
        void _language;
        const smtpHost = this.configService.get("EMAIL_SERVER_HOST");
        const smtpUser = this.configService.get("EMAIL_SERVER_USER");
        const smtpPass = this.configService.get("EMAIL_SERVER_PASSWORD");
        const from = this.configService.get("EMAIL_FROM") ||
            smtpUser ||
            "noreply@archaser.com";
        if (!smtpHost || !smtpUser || !smtpPass) {
            return;
        }
        try {
            const nodemailer = require("nodemailer");
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port: Number(this.configService.get("EMAIL_SERVER_PORT") || 587),
                secure: false,
                auth: { user: smtpUser, pass: smtpPass },
            });
            await transporter.sendMail({
                from,
                to: email,
                subject: "Reset your Archaser password",
                text: `Use this link to reset your password (valid 1 hour):\n${resetLink}`,
                html: `<p>Use this link to reset your password (valid 1 hour):</p><p><a href="${resetLink}">${resetLink}</a></p>`,
            });
        }
        catch {
            return;
        }
    }
    probeAccountScope(user, accountId) {
        if (user.account_id == null || Number(user.account_id) !== accountId) {
            throw new common_1.ForbiddenException("Account scope mismatch");
        }
        return { ok: true, account_id: accountId };
    }
    async findAccountBySubdomain(subdomain) {
        const account = await this.database.account.findFirst({
            where: {
                sub_domain: {
                    equals: subdomain,
                    mode: "insensitive",
                },
                deleted_at: null,
            },
            select: {
                id: true,
                name: true,
                sso_enabled: true,
                sso_providers: true,
            },
        });
        if (!account) {
            throw new common_1.NotFoundException("Account not found");
        }
        const ssoProviders = account.sso_providers
            ? account.sso_providers.split(",").map((p) => p.trim())
            : [];
        return {
            accountId: account.id,
            name: account.name ?? `Account ${account.id}`,
            ssoEnabled: account.sso_enabled ?? false,
            ssoProviders,
        };
    }
    async resolveSsoUser(emailRaw, provider) {
        try {
            const email = this.normalizeEmail(emailRaw);
            if (!email) {
                return { ok: false, error: "AccessDenied" };
            }
            const dbUser = await this.database.user.findFirst({
                where: {
                    email,
                    deactivated_at: null,
                },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    name: true,
                    account_id: true,
                    role: true,
                    freeze: true,
                    status: true,
                },
            });
            if (!dbUser) {
                return { ok: false, error: "AccessDenied" };
            }
            if (dbUser.freeze === true) {
                return { ok: false, error: "AccountFrozen" };
            }
            if (dbUser.status === "Inactive") {
                return { ok: false, error: "Inactive" };
            }
            if (!dbUser.account_id) {
                return { ok: false, error: "SSONotEnabled" };
            }
            const account = await this.database.account.findUnique({
                where: { id: dbUser.account_id },
                select: {
                    sso_enabled: true,
                    sso_providers: true,
                },
            });
            if (!account?.sso_enabled) {
                return { ok: false, error: "SSONotEnabled" };
            }
            const allowedProviders = account.sso_providers
                ?.split(",")
                .map((p) => p.trim())
                .filter(Boolean) || [];
            if (!allowedProviders.includes(provider)) {
                return { ok: false, error: "AccessDenied" };
            }
            return {
                ok: true,
                payload: {
                    sub: dbUser.id,
                    username: dbUser.username,
                    email: dbUser.email,
                    account_id: dbUser.account_id,
                    role: dbUser.role,
                    name: dbUser.name,
                },
            };
        }
        catch {
            return { ok: false, error: "Configuration" };
        }
    }
    async issueTokenResponse(payload) {
        return {
            access_token: await this.jwtService.signAsync(payload),
            token_type: "Bearer",
        };
    }
    buildSuccessRedirectUrl(accessToken) {
        const base = this.configService.get("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000/login";
        const url = new URL(base.includes("://") ? base : `http://localhost:3000${base}`);
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/login";
        }
        url.searchParams.set("nest_token", accessToken);
        return url.toString();
    }
    buildErrorRedirectUrl(error) {
        const base = this.configService.get("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000/login";
        const url = new URL(base.includes("://") ? base : `http://localhost:3000${base}`);
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/login";
        }
        url.searchParams.set("error", error);
        return url.toString();
    }
    normalizeEmail(email) {
        return email?.toLowerCase().trim() ?? "";
    }
    isGoogleConfigured() {
        return Boolean(this.configService.get("GOOGLE_CLIENT_ID") ||
            this.configService.get("NEXT_PUBLIC_GOOGLE_CLIENT_ID")) &&
            Boolean(this.configService.get("GOOGLE_CLIENT_SECRET") ||
                this.configService.get("NEXT_PUBLIC_GOOGLE_CLIENT_SECRET"));
    }
    isAzureConfigured() {
        return Boolean(this.configService.get("MICROSOFT_CLIENT_ID") ||
            this.configService.get("NEXT_PUBLIC_MICROSOFT_CLIENT_ID")) &&
            Boolean(this.configService.get("MICROSOFT_CLIENT_SECRET") ||
                this.configService.get("NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET"));
    }
    getPublicBaseUrl() {
        return (this.configService.get("NEST_PUBLIC_URL") ||
            `http://localhost:${this.configService.get("NEST_PORT") || 3002}`).replace(/\/$/, "");
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map