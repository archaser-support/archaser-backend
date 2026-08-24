import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { DatabaseService } from "../database/database.service";
import { SystemEmailService } from "../email/system-email.service";
import { LoginDto } from "./dto/login.dto";
import {
    AccountBySubdomainResponseDto,
    LoginResponseDto,
    MeResponseDto,
    ScopeProbeResponseDto,
} from "./dto/auth-response.dto";

export interface JwtPayload {
    sub: string;
    username: string;
    email?: string | null;
    account_id?: number | null;
    role?: string | null;
    name?: string | null;
    language?: string | null;
    timezone?: string | null;
    locale?: string | null;
    account_name?: string | null;
    primary_color?: string | null;
    secondary_color?: string | null;
    chart_palette_color?: string | null;
    currency?: string | null;
    sidebar_collapsed?: boolean | null;
}

export type SsoProviderId = "google" | "microsoft";

@Injectable()
export class AuthService {
    constructor(
        private readonly database: DatabaseService,
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly systemEmail: SystemEmailService
    ) {}

    async login(credentials: LoginDto): Promise<LoginResponseDto> {
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
            throw new UnauthorizedException("Invalid credentials");
        }

        if (user.freeze === true) {
            throw new UnauthorizedException(
                "Your account has been frozen due to multiple failed login attempts. Please contact an administrator."
            );
        }

        const valid = await bcrypt.compare(
            credentials.password,
            user.password
        );
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

            throw new UnauthorizedException("Invalid credentials");
        }

        if ((user.failed_login_attempts || 0) > 0) {
            await this.database.user.update({
                where: { id: user.id },
                data: { failed_login_attempts: 0 },
            });
        }

        if (user.status === "Inactive") {
            throw new UnauthorizedException(
                "Your account is currently inactive. Please contact support."
            );
        }

        const account = user.account_id
            ? await this.database.account.findUnique({
                  where: { id: user.account_id },
                  select: {
                      name: true,
                      primary_color: true,
                      secondary_color: true,
                      chart_palette_color: true,
                      currency: true,
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
            chart_palette_color: account?.chart_palette_color ?? null,
            currency: account?.currency ?? null,
            sidebar_collapsed: user.sidebar_collapsed ?? null,
        });
    }

    async getProfile(user: JwtPayload): Promise<MeResponseDto> {
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
            throw new UnauthorizedException("User not found");
        }

        const account = dbUser.account_id
            ? await this.database.account.findUnique({
                  where: { id: dbUser.account_id },
                  select: {
                      name: true,
                      primary_color: true,
                      secondary_color: true,
                      chart_palette_color: true,
                      currency: true,
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
            chart_palette_color: account?.chart_palette_color ?? null,
            currency: account?.currency ?? null,
            sidebar_collapsed: dbUser.sidebar_collapsed ?? null,
        };
    }

    async requestPasswordReset(
        email: string,
        language?: string
    ): Promise<{ message: string }> {
        const user = await this.database.user.findFirst({
            where: { email },
        });
        if (!user) {
            throw new NotFoundException("User not found");
        }

        const crypto = await import("crypto");
        const resetToken = crypto.randomBytes(32).toString("hex");
        const resetTokenExpiry = new Date(Date.now() + 3600000);

        await this.database.user.update({
            where: { id: user.id },
            data: { resetToken, resetTokenExpiry },
        });

        const frontendBase =
            this.configService.get<string>("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get<string>("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000";
        const origin = frontendBase.replace(/\/login\/?$/, "").replace(/\/$/, "");
        const resetLink = `${origin}/reset-password/${resetToken}`;

        // Email delivery is best-effort; token is always persisted for reset.
        try {
            await this.systemEmail.sendResetPasswordEmail(
                resetLink,
                email,
                language
            );
        } catch {
            // Token is already stored; email failure should not block the request.
        }

        return { message: "Reset link sent to your email" };
    }

    async resetPassword(
        token: string,
        password: string
    ): Promise<{ message: string }> {
        const errors = this.validatePasswordComplexity(password);
        if (errors.length > 0) {
            throw new BadRequestException(errors.join(", "));
        }

        const user = await this.database.user.findFirst({
            where: {
                resetToken: token,
                resetTokenExpiry: { gt: new Date() },
            },
        });
        if (!user) {
            throw new BadRequestException("Invalid or expired token");
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
            message:
                "Password reset successfully. All existing sessions have been invalidated.",
        };
    }

    private validatePasswordComplexity(password: string): string[] {
        const errors: string[] = [];
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

    /**
     * Adapter over SystemEmailService branded templates.
     * Missing SMTP / send failure does not throw (token is already stored).
     */
    async sendPasswordSetupEmail(
        email: string,
        resetLink: string,
        options?: { language?: string; kind?: "reset" | "welcome" }
    ): Promise<void> {
        try {
            if (options?.kind === "welcome") {
                await this.systemEmail.sendWelcomeUserEmail(
                    email,
                    "",
                    resetLink,
                    options.language
                );
                return;
            }
            await this.systemEmail.sendResetPasswordEmail(
                resetLink,
                email,
                options?.language
            );
        } catch {
            // Token is already stored; email failure should not block the request.
            return;
        }
    }

    private async sendResetPasswordEmail(
        email: string,
        resetLink: string,
        language?: string
    ): Promise<void> {
        await this.sendPasswordSetupEmail(email, resetLink, {
            language,
            kind: "reset",
        });
    }

    probeAccountScope(
        user: JwtPayload,
        accountId: number
    ): ScopeProbeResponseDto {
        if (user.account_id == null || Number(user.account_id) !== accountId) {
            throw new ForbiddenException("Account scope mismatch");
        }
        return { ok: true, account_id: accountId };
    }

    async findAccountBySubdomain(
        subdomain: string
    ): Promise<AccountBySubdomainResponseDto> {
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
            throw new NotFoundException("Account not found");
        }

        const ssoProviders = account.sso_providers
            ? account.sso_providers.split(",").map((p: string) => p.trim())
            : [];

        return {
            accountId: account.id,
            name: account.name ?? `Account ${account.id}`,
            ssoEnabled: account.sso_enabled ?? false,
            ssoProviders,
        };
    }

    /**
     * Validates SSO login for a pre-provisioned user by email.
     * Returns Nest JWT payload or an error code matching NextAuth redirects.
     */
    async resolveSsoUser(
        emailRaw: string | null | undefined,
        provider: SsoProviderId
    ): Promise<
        | { ok: true; payload: JwtPayload }
        | {
              ok: false;
              error:
                  | "AccessDenied"
                  | "AccountFrozen"
                  | "Inactive"
                  | "SSONotEnabled"
                  | "Configuration";
          }
    > {
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
                    currency: true,
                    name: true,
                    primary_color: true,
                    secondary_color: true,
                    chart_palette_color: true,
                },
            });

            if (!account?.sso_enabled) {
                return { ok: false, error: "SSONotEnabled" };
            }

            const allowedProviders =
                account.sso_providers
                    ?.split(",")
                    .map((p: string) => p.trim())
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
                    account_name: account.name ?? null,
                    primary_color: account.primary_color ?? null,
                    secondary_color: account.secondary_color ?? null,
                    chart_palette_color: account.chart_palette_color ?? null,
                    currency: account.currency ?? null,
                },
            };
        } catch {
            return { ok: false, error: "Configuration" };
        }
    }

    async issueTokenResponse(payload: JwtPayload): Promise<LoginResponseDto> {
        return {
            access_token: await this.jwtService.signAsync(payload),
            token_type: "Bearer",
        };
    }

    buildSuccessRedirectUrl(accessToken: string): string {
        const base =
            this.configService.get<string>("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get<string>("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000/login";
        const url = new URL(
            base.includes("://") ? base : `http://localhost:3000${base}`
        );
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/login";
        }
        url.searchParams.set("nest_token", accessToken);
        return url.toString();
    }

    buildErrorRedirectUrl(
        error:
            | "AccessDenied"
            | "AccountFrozen"
            | "Inactive"
            | "SSONotEnabled"
            | "Configuration"
    ): string {
        const base =
            this.configService.get<string>("NEST_AUTH_SUCCESS_REDIRECT") ||
            this.configService.get<string>("NEXT_PUBLIC_BASE_URL") ||
            "http://localhost:3000/login";
        const url = new URL(
            base.includes("://") ? base : `http://localhost:3000${base}`
        );
        if (!url.pathname || url.pathname === "/") {
            url.pathname = "/login";
        }
        url.searchParams.set("error", error);
        return url.toString();
    }

    normalizeEmail(email: string | null | undefined): string {
        return email?.toLowerCase().trim() ?? "";
    }

    isGoogleConfigured(): boolean {
        return Boolean(
            this.configService.get("GOOGLE_CLIENT_ID") ||
                this.configService.get("NEXT_PUBLIC_GOOGLE_CLIENT_ID")
        ) &&
            Boolean(
                this.configService.get("GOOGLE_CLIENT_SECRET") ||
                    this.configService.get("NEXT_PUBLIC_GOOGLE_CLIENT_SECRET")
            );
    }

    isAzureConfigured(): boolean {
        return Boolean(
            this.configService.get("MICROSOFT_CLIENT_ID") ||
                this.configService.get("NEXT_PUBLIC_MICROSOFT_CLIENT_ID")
        ) &&
            Boolean(
                this.configService.get("MICROSOFT_CLIENT_SECRET") ||
                    this.configService.get(
                        "NEXT_PUBLIC_MICROSOFT_CLIENT_SECRET"
                    )
            );
    }

    getPublicBaseUrl(): string {
        return (
            this.configService.get<string>("NEST_PUBLIC_URL") ||
            `http://localhost:${this.configService.get("NEST_PORT") || 3002}`
        ).replace(/\/$/, "");
    }
}
