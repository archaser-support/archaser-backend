import { ReportsService } from "../src/reports/reports.service";
import { reportVisibilityWhere } from "../src/reports/report-scope.util";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

/**
 * Tenant isolation for report definitions.
 *
 * System reports are seeded per account, so every account owns its own `is_system`
 * copies. Matching `is_system` / `is_public` without an account filter used to expose
 * every other tenant's reports (1,783 foreign rows for a single test account).
 */
const ACCOUNT_ID = 42;
const OTHER_ACCOUNT_ID = 99;

const user = { sub: "user-1" } as unknown as JwtPayload;

function buildService(reportRows: unknown[] = []) {
    const findMany = jest.fn().mockResolvedValue(reportRows);
    const count = jest.fn().mockResolvedValue(reportRows.length);
    // Report 7 belongs to the caller's account; 1234 belongs to another tenant.
    const stored = [
        { id: 7, account_id: ACCOUNT_ID, is_system: true, is_public: true },
        {
            id: 1234,
            account_id: OTHER_ACCOUNT_ID,
            is_system: true,
            is_public: true,
        },
    ];
    const findFirst = jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
            stored.find(
                (row) =>
                    row.id === where.id &&
                    (where.account_id === undefined ||
                        row.account_id === where.account_id)
            ) ?? null
    );

    const db = {
        account: {
            findUnique: jest
                .fn()
                .mockResolvedValue({ has_credit_insurance: true }),
        },
        report: { findMany, count, findFirst },
        userDefaultReport: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as DatabaseService;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        hasPermission: jest.fn().mockResolvedValue(true),
    } as unknown as AccessScopeService;

    return { service: new ReportsService(db, accessScope), findMany, findFirst };
}

/** Collect every account_id constraint anywhere in a nested Prisma where clause. */
function collectAccountIds(where: unknown, found: unknown[] = []): unknown[] {
    if (Array.isArray(where)) {
        for (const entry of where) {
            collectAccountIds(entry, found);
        }
        return found;
    }
    if (where && typeof where === "object") {
        for (const [key, value] of Object.entries(where)) {
            if (key === "account_id") {
                found.push(value);
            } else {
                collectAccountIds(value, found);
            }
        }
    }
    return found;
}

function serializeWhere(where: unknown): string {
    return JSON.stringify(where);
}

describe("report definition visibility", () => {
    afterEach(() => jest.clearAllMocks());

    it("scopes the visibility clause to the caller's account", () => {
        expect(reportVisibilityWhere(ACCOUNT_ID)).toEqual({
            account_id: ACCOUNT_ID,
        });
    });

    it("filters the list query by account and nothing else", async () => {
        const { service, findMany } = buildService();

        await service.list(user, {});

        const where = findMany.mock.calls[0][0].where;
        expect(collectAccountIds(where)).toEqual([ACCOUNT_ID]);
    });

    it("never lists reports via unscoped is_system or is_public branches", async () => {
        const { service, findMany } = buildService();

        await service.list(user, {});

        // These flags must not appear as standalone visibility escape hatches.
        const serialized = serializeWhere(findMany.mock.calls[0][0].where);
        expect(serialized).not.toContain("is_system");
        expect(serialized).not.toContain("is_public");
        expect(serialized).not.toContain("ReportShare");
    });

    it("keeps the account filter alongside search and context filters", async () => {
        const { service, findMany } = buildService();

        await service.list(user, { context: "customers", search: "overdue" });

        const where = findMany.mock.calls[0][0].where;
        expect(collectAccountIds(where)).toEqual([ACCOUNT_ID]);
        expect(serializeWhere(where)).toContain("overdue");
    });

    it("404s when opening a report owned by another account", async () => {
        const { service, findFirst } = buildService();

        await expect(service.getById(user, 1234)).rejects.toMatchObject({
            status: 404,
        });

        expect(findFirst.mock.calls[0][0].where).toEqual({
            id: 1234,
            account_id: ACCOUNT_ID,
        });
        expect(findFirst.mock.calls[0][0].where.account_id).not.toBe(
            OTHER_ACCOUNT_ID
        );
    });

    it("returns a report that belongs to the caller's account", async () => {
        const { service } = buildService();

        await expect(service.getById(user, 7)).resolves.toMatchObject({
            report: expect.objectContaining({ account_id: ACCOUNT_ID }),
        });
    });
});
