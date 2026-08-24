import { ForbiddenException } from "@nestjs/common";
import { SystemService } from "../src/system/system.service";

function user(accountId = 10013) {
    return {
        sub: "user-1",
        username: "admin",
        account_id: accountId,
        role: "archaser_admin",
    };
}

function accessScope(isAdmin = true) {
    return {
        resolveUserInfo: jest.fn().mockResolvedValue({
            userId: "user-1",
            accountId: 10013,
            role: "archaser_admin",
        }),
        getEffectiveAccountId: jest.fn().mockReturnValue(10013),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        isAdminAccount: jest.fn().mockReturnValue(isAdmin),
    };
}

function service(database: Record<string, unknown>, admin = true) {
    return new SystemService(
        database as never,
        accessScope(admin) as never,
        {} as never,
        {} as never
    );
}

describe("getSystemHealth JSON", () => {
    it("rejects non-admin accounts", async () => {
        await expect(
            service({ cronJob: { findMany: jest.fn() } }, false).getSystemHealth(
                user(10117)
            )
        ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("queries activity_status enums Prisma accepts (COMPLETED/FAILED/SCHEDULED/SENT)", async () => {
        const count = jest.fn().mockResolvedValue(0);
        const groupBy = jest.fn().mockResolvedValue([]);
        const db = {
            cronJob: { findMany: jest.fn().mockResolvedValue([]) },
            activity: { count, groupBy },
            importJob: { findMany: jest.fn().mockResolvedValue([]) },
        };
        const result = await service(db).getSystemHealth(user());
        expect(result.cronJobs.overview.totalJobs).toBe(0);
        expect(result.activities.email.sent24h).toBe(0);
        expect(result.imports.overview.total30d).toBe(0);

        const statuses = count.mock.calls
            .map((call) => call[0]?.where?.status)
            .filter(Boolean);
        expect(statuses).toEqual(
            expect.arrayContaining(["COMPLETED", "FAILED"])
        );
        expect(statuses).not.toEqual(
            expect.arrayContaining(["Completed", "Failed"])
        );

        const stuckStatus = groupBy.mock.calls[0]?.[0]?.where?.status?.in;
        expect(stuckStatus).toEqual(["SCHEDULED", "SENT"]);
    });
});
