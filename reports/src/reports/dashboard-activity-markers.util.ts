import { ReportFilterDto } from "./dto/execute-report.dto";

type PrismaWhere = Record<string, unknown>;

export const DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD =
    "__dashboard_activity_identity";
export const DASHBOARD_TOTAL_CALLS_FILTER_FIELD = "__dashboard_total_calls";

export type DashboardActivityIdentityMode =
    | "agents_excl_audit"
    | "all_agents_incl_audit"
    | "system"
    | "portal";

type UserDelegate = {
    findMany: (args: {
        where: Record<string, unknown>;
        select: { id: true };
    }) => Promise<Array<{ id: string }>>;
};

type DbLike = {
    user: UserDelegate;
};

export function systemUserIdForAccount(accountId: number): string {
    return `11111111-1111-1111-1111-${accountId.toString().padStart(12, "0")}`;
}

export function portalUserIdForAccount(accountId: number): string {
    return `00000000-0000-0000-0000-${accountId.toString().padStart(12, "0")}`;
}

function isAuditUserId(userId: string): boolean {
    return (
        userId.startsWith("11111111-1111-1111-1111-") ||
        userId.startsWith("00000000-0000-0000-0000-")
    );
}

export function expandDashboardTotalCallsWhere(): PrismaWhere {
    return {
        OR: [
            { type: { in: ["Call", "Promise_to_pay"] } },
            {
                AND: [
                    { type: "Dispute" },
                    {
                        title: {
                            contains: "filed",
                            mode: "insensitive",
                        },
                    },
                ],
            },
        ],
    };
}

export function resolveCreatedByForIdentityMode(input: {
    identityMode: DashboardActivityIdentityMode;
    accountId: number;
    agentIds: string[];
    selectedUserId?: string | null;
}): string | { in: string[] } {
    const systemUserId = systemUserIdForAccount(input.accountId);
    const portalUserId = portalUserIdForAccount(input.accountId);

    if (input.identityMode === "system") {
        return systemUserId;
    }
    if (input.identityMode === "portal") {
        return portalUserId;
    }

    let queryIds = [...input.agentIds];
    if (!input.selectedUserId) {
        queryIds.push(systemUserId, portalUserId);
    }

    if (input.identityMode === "agents_excl_audit") {
        queryIds = queryIds.filter(
            (id) => id !== systemUserId && id !== portalUserId
        );
    }

    return { in: queryIds };
}

async function resolveAgentIds(input: {
    db: DbLike;
    accountId: number;
    selectedUserId?: string | null;
}): Promise<string[]> {
    const where: Record<string, unknown> = {
        account_id: input.accountId,
        status: "Active",
        deactivated_at: null,
    };
    if (input.selectedUserId) {
        where.id = input.selectedUserId;
    }

    const users = await input.db.user.findMany({
        where,
        select: { id: true },
    });

    let agentIds = users
        .map((u) => u.id)
        .filter((id) => !isAuditUserId(id));

    if (input.selectedUserId) {
        agentIds = agentIds.includes(input.selectedUserId)
            ? [input.selectedUserId]
            : [];
    }

    return agentIds;
}

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
export async function prepareDashboardActivityMarkers(
    filters: ReportFilterDto[],
    options: {
        db: DbLike;
        accountId: number;
        selectedUserId?: string | null;
        isAdmin?: boolean;
    }
): Promise<PreparedDashboardActivityMarkers> {
    void options.isAdmin;

    if (!filters?.length) {
        return { filters: filters ?? [], skipsSelectedUserScope: false };
    }

    const identityIndex = filters.findIndex(
        (f) =>
            f.table === "Activity" &&
            f.field === DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD
    );
    const totalCallsIndex = filters.findIndex(
        (f) =>
            f.table === "Activity" &&
            f.field === DASHBOARD_TOTAL_CALLS_FILTER_FIELD
    );

    if (identityIndex < 0 && totalCallsIndex < 0) {
        return { filters, skipsSelectedUserScope: false };
    }

    const identityMode =
        identityIndex >= 0
            ? (String(
                  filters[identityIndex].value
              ) as DashboardActivityIdentityMode)
            : null;

    const rest = filters.filter(
        (_, i) => i !== identityIndex && i !== totalCallsIndex
    );

    const primaryWhereExtras: PrismaWhere = {};

    if (identityMode) {
        const agentIds = await resolveAgentIds({
            db: options.db,
            accountId: options.accountId,
            selectedUserId: options.selectedUserId,
        });
        primaryWhereExtras.created_by = resolveCreatedByForIdentityMode({
            identityMode,
            accountId: options.accountId,
            agentIds,
            selectedUserId: options.selectedUserId,
        });
    }

    if (totalCallsIndex >= 0) {
        Object.assign(primaryWhereExtras, expandDashboardTotalCallsWhere());
    }

    return {
        filters: rest,
        primaryWhereExtras:
            Object.keys(primaryWhereExtras).length > 0
                ? primaryWhereExtras
                : undefined,
        skipsSelectedUserScope: identityIndex >= 0,
    };
}
