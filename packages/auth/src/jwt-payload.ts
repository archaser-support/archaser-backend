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
    /** NextAuth view-as; forwarded from session cookie into DualAuth req.user. */
    view_as_user_id?: string | null;
    view_as_user_role?: string | null;
    view_as_user_account_id?: number | null;
    view_as_user_name?: string | null;
    view_as_user_account_name?: string | null;
}
