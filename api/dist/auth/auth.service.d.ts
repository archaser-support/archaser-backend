import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import { SystemEmailService } from "../email/system-email.service";
import { LoginDto } from "./dto/login.dto";
import { AccountBySubdomainResponseDto, LoginResponseDto, MeResponseDto, ScopeProbeResponseDto } from "./dto/auth-response.dto";
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
    currency?: string | null;
    sidebar_collapsed?: boolean | null;
}
export type SsoProviderId = "google" | "microsoft";
export declare class AuthService {
    private readonly database;
    private readonly jwtService;
    private readonly configService;
    private readonly systemEmail;
    constructor(database: DatabaseService, jwtService: JwtService, configService: ConfigService, systemEmail: SystemEmailService);
    login(credentials: LoginDto): Promise<LoginResponseDto>;
    getProfile(user: JwtPayload): Promise<MeResponseDto>;
    requestPasswordReset(email: string, language?: string): Promise<{
        message: string;
    }>;
    resetPassword(token: string, password: string): Promise<{
        message: string;
    }>;
    private validatePasswordComplexity;
    sendPasswordSetupEmail(email: string, resetLink: string, options?: {
        language?: string;
        kind?: "reset" | "welcome";
    }): Promise<void>;
    private sendResetPasswordEmail;
    probeAccountScope(user: JwtPayload, accountId: number): ScopeProbeResponseDto;
    findAccountBySubdomain(subdomain: string): Promise<AccountBySubdomainResponseDto>;
    resolveSsoUser(emailRaw: string | null | undefined, provider: SsoProviderId): Promise<{
        ok: true;
        payload: JwtPayload;
    } | {
        ok: false;
        error: "AccessDenied" | "AccountFrozen" | "Inactive" | "SSONotEnabled" | "Configuration";
    }>;
    issueTokenResponse(payload: JwtPayload): Promise<LoginResponseDto>;
    buildSuccessRedirectUrl(accessToken: string): string;
    buildErrorRedirectUrl(error: "AccessDenied" | "AccountFrozen" | "Inactive" | "SSONotEnabled" | "Configuration"): string;
    normalizeEmail(email: string | null | undefined): string;
    isGoogleConfigured(): boolean;
    isAzureConfigured(): boolean;
    getPublicBaseUrl(): string;
}
