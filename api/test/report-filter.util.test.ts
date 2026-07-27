import {
    operatorToPrisma,
    splitFiltersByTable,
} from "../src/reports/report-filter.util";
import {
    expandDashboardTotalCallsWhere,
    prepareDashboardActivityMarkers,
    resolveCreatedByForIdentityMode,
    systemUserIdForAccount,
    portalUserIdForAccount,
} from "../src/reports/dashboard-activity-markers.util";

describe("operatorToPrisma date coercion", () => {
    it("converts YYYY-MM-DD between bounds to ISO DateTime Dates", () => {
        const clause = operatorToPrisma("between", [
            "2025-07-27",
            "2026-07-27",
        ]);
        expect(clause).toEqual({
            gte: new Date("2025-07-27T00:00:00.000Z"),
            lte: new Date("2026-07-27T23:59:59.999Z"),
        });
        expect(clause!.gte).toBeInstanceOf(Date);
        expect(clause!.lte).toBeInstanceOf(Date);
    });

    it("converts date-only equals into a full-day range", () => {
        expect(operatorToPrisma("equals", "2025-07-27")).toEqual({
            gte: new Date("2025-07-27T00:00:00.000Z"),
            lte: new Date("2025-07-27T23:59:59.999Z"),
        });
    });
});

describe("splitFiltersByTable drops dashboard markers from primary", () => {
    it("does not put __dashboard_activity_identity into Prisma field map", () => {
        const { primary } = splitFiltersByTable(
            [
                {
                    table: "Activity",
                    field: "created_at",
                    operator: "between",
                    value: ["2025-07-27", "2026-07-27"],
                },
                {
                    table: "Activity",
                    field: "__dashboard_activity_identity",
                    operator: "equals",
                    value: "system",
                },
            ],
            "Activity",
            { skipFields: new Set(["__dashboard_activity_identity"]) }
        );
        expect(primary).not.toHaveProperty("__dashboard_activity_identity");
        expect(primary.created_at).toEqual({
            gte: new Date("2025-07-27T00:00:00.000Z"),
            lte: new Date("2026-07-27T23:59:59.999Z"),
        });
    });
});

describe("dashboard activity identity markers", () => {
    const accountId = 10117;
    const systemId = systemUserIdForAccount(accountId);
    const portalId = portalUserIdForAccount(accountId);

    it("maps system / portal identity modes to audit user ids", () => {
        expect(
            resolveCreatedByForIdentityMode({
                identityMode: "system",
                accountId,
                agentIds: ["a1"],
            })
        ).toBe(systemId);
        expect(
            resolveCreatedByForIdentityMode({
                identityMode: "portal",
                accountId,
                agentIds: ["a1"],
            })
        ).toBe(portalId);
    });

    it("excludes audit users for agents_excl_audit", () => {
        expect(
            resolveCreatedByForIdentityMode({
                identityMode: "agents_excl_audit",
                accountId,
                agentIds: ["a1", "a2"],
                selectedUserId: null,
            })
        ).toEqual({ in: ["a1", "a2"] });
    });

    it("includes audit users for all_agents_incl_audit when no selected user", () => {
        expect(
            resolveCreatedByForIdentityMode({
                identityMode: "all_agents_incl_audit",
                accountId,
                agentIds: ["a1"],
                selectedUserId: null,
            })
        ).toEqual({ in: ["a1", systemId, portalId] });
    });

    it("expands markers into created_by + total-calls OR and strips them from filters", async () => {
        const db = {
            user: {
                findMany: jest.fn().mockResolvedValue([
                    { id: "agent-1" },
                    { id: systemId },
                ]),
            },
        };

        const prepared = await prepareDashboardActivityMarkers(
            [
                {
                    table: "Activity",
                    field: "created_at",
                    operator: "between",
                    value: ["2025-07-27", "2026-07-27"],
                },
                {
                    table: "Activity",
                    field: "__dashboard_activity_identity",
                    operator: "equals",
                    value: "system",
                },
                {
                    table: "Activity",
                    field: "__dashboard_total_calls",
                    operator: "equals",
                    value: true,
                },
            ],
            {
                db: db as never,
                accountId,
                selectedUserId: null,
                isAdmin: true,
            }
        );

        expect(prepared.filters).toEqual([
            {
                table: "Activity",
                field: "created_at",
                operator: "between",
                value: ["2025-07-27", "2026-07-27"],
            },
        ]);
        expect(prepared.primaryWhereExtras).toEqual({
            created_by: systemId,
            ...expandDashboardTotalCallsWhere(),
        });
        expect(prepared.skipsSelectedUserScope).toBe(true);
    });
});
