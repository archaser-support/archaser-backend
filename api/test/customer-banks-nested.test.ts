import { NotFoundException } from "@nestjs/common";
import { AccountAdminEntitiesService } from "../src/account-admin/account-admin-entities.service";

function user(accountId = 10117) {
    return {
        sub: "user-1",
        username: "admin",
        account_id: accountId,
        role: "System_Administrator",
    };
}

function accessScope(accountId = 10117) {
    return {
        resolveUserInfo: jest.fn().mockResolvedValue({
            userId: "user-1",
            accountId,
            role: "System_Administrator",
        }),
        getEffectiveAccountId: jest.fn().mockReturnValue(accountId),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        isAdminAccount: jest.fn().mockReturnValue(false),
    };
}

describe("nested customer-banks JSON the grids already read", () => {
    it("lists { data, totalRecords } scoped to the caller's account", async () => {
        const rows = [
            {
                id: 133,
                customer_id: 1584,
                account_id: 10117,
                customer_bank_account_id: 19,
            },
        ];
        const db = {
            customer: {
                findFirst: jest
                    .fn()
                    .mockResolvedValue({ id: 1584, account_id: 10117 }),
            },
            customerBanks: {
                findMany: jest.fn().mockResolvedValue(rows),
            },
        };
        const svc = new AccountAdminEntitiesService(
            db as never,
            accessScope() as never,
            {} as never
        );
        const result = await svc.listCustomerBanks(user(), "1584");
        expect(result).toEqual({ data: rows, totalRecords: 1 });
        expect(db.customer.findFirst).toHaveBeenCalledWith({
            where: { id: 1584, account_id: 10117 },
            select: { id: true, account_id: true },
        });
        expect(db.customerBanks.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { customer_id: 1584, account_id: 10117 },
            })
        );
    });

    it("404s when the customer is not in the caller's account", async () => {
        const db = {
            customer: { findFirst: jest.fn().mockResolvedValue(null) },
            customerBanks: { findMany: jest.fn() },
        };
        const svc = new AccountAdminEntitiesService(
            db as never,
            accessScope(10013) as never,
            {} as never
        );
        await expect(
            svc.listCustomerBanks(user(10013), "1584")
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(db.customerBanks.findMany).not.toHaveBeenCalled();
    });
});
