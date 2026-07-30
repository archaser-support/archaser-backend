export declare class LoginResponseDto {
    access_token: string;
    token_type: string;
}
export declare class MeResponseDto {
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
export declare class AccountBySubdomainResponseDto {
    accountId: number;
    name: string;
    ssoEnabled: boolean;
    ssoProviders: string[];
}
export declare class ScopeProbeResponseDto {
    ok: boolean;
    account_id: number;
}
export declare class ForgetPasswordDto {
    email: string;
    language?: string;
}
export declare class ResetPasswordDto {
    token: string;
    password: string;
}
export declare class MessageResponseDto {
    message: string;
}
