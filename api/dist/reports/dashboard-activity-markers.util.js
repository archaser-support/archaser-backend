"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_TOTAL_CALLS_FILTER_FIELD = exports.DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD = void 0;
exports.systemUserIdForAccount = systemUserIdForAccount;
exports.portalUserIdForAccount = portalUserIdForAccount;
exports.expandDashboardTotalCallsWhere = expandDashboardTotalCallsWhere;
exports.resolveCreatedByForIdentityMode = resolveCreatedByForIdentityMode;
exports.prepareDashboardActivityMarkers = prepareDashboardActivityMarkers;
exports.DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD = "__dashboard_activity_identity";
exports.DASHBOARD_TOTAL_CALLS_FILTER_FIELD = "__dashboard_total_calls";
function systemUserIdForAccount(accountId) {
    return `11111111-1111-1111-1111-${accountId.toString().padStart(12, "0")}`;
}
function portalUserIdForAccount(accountId) {
    return `00000000-0000-0000-0000-${accountId.toString().padStart(12, "0")}`;
}
function isAuditUserId(userId) {
    return (userId.startsWith("11111111-1111-1111-1111-") ||
        userId.startsWith("00000000-0000-0000-0000-"));
}
function expandDashboardTotalCallsWhere() {
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
function resolveCreatedByForIdentityMode(input) {
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
        queryIds = queryIds.filter((id) => id !== systemUserId && id !== portalUserId);
    }
    return { in: queryIds };
}
async function resolveAgentIds(input) {
    const where = {
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
async function prepareDashboardActivityMarkers(filters, options) {
    void options.isAdmin;
    if (!filters?.length) {
        return { filters: filters ?? [], skipsSelectedUserScope: false };
    }
    const identityIndex = filters.findIndex((f) => f.table === "Activity" &&
        f.field === exports.DASHBOARD_ACTIVITY_IDENTITY_FILTER_FIELD);
    const totalCallsIndex = filters.findIndex((f) => f.table === "Activity" &&
        f.field === exports.DASHBOARD_TOTAL_CALLS_FILTER_FIELD);
    if (identityIndex < 0 && totalCallsIndex < 0) {
        return { filters, skipsSelectedUserScope: false };
    }
    const identityMode = identityIndex >= 0
        ? String(filters[identityIndex].value)
        : null;
    const rest = filters.filter((_, i) => i !== identityIndex && i !== totalCallsIndex);
    const primaryWhereExtras = {};
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
        primaryWhereExtras: Object.keys(primaryWhereExtras).length > 0
            ? primaryWhereExtras
            : undefined,
        skipsSelectedUserScope: identityIndex >= 0,
    };
}
//# sourceMappingURL=dashboard-activity-markers.util.js.map