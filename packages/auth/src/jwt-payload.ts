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
