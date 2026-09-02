import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
export declare const DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD = "__dashboard_activity_identity";
export declare const DASHBOARD_TOTAL_CALLS_FILTER_FIELD = "__dashboard_total_calls";
export type DashboardActivityIdentityMode = "agents_excl_audit" | "all_agents_incl_audit" | "system" | "portal";
type UserDelegate = {
    findMany: (args: {
        where: Record<string, unknown>;
        select: {
            id: true;
        };
    }) => Promise<Array<{
        id: string;
    }>>;
};
type DbLike = {
    user: UserDelegate;
};
export declare function systemUserIdForAccount(accountId: number): string;
export declare function portalUserIdForAccount(accountId: number): string;
export declare function expandDashboardTotalCallsWhere(): PrismaWhere;
export declare function resolveCreatedByForIdentityMode(input: {
    identityMode: DashboardActivityIdentityMode;
    accountId: number;
    agentIds: string[];
    selectedUserId?: string | null;
}): string | {
    in: string[];
};
export type PreparedDashboardActivityMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
    /** When true, do not also AND body.selectedUserId onto Activity scope. */
    skipsSelectedUserScope: boolean;
};
/**
 * Strip Activity dashboard markers and expand into Prisma where extras.
 * Mirrors frontend prepareDashboardActivityExecuteFilters.
 */
export declare function prepareDashboardActivityMarkers(filters: ReportFilterDto[], options: {
    db: DbLike;
    accountId: number;
    selectedUserId?: string | null;
    isAdmin?: boolean;
}): Promise<PreparedDashboardActivityMarkers>;
export {};
