import { CustomersService } from "../src/customers/customers.service";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

/**
 * Top-ups moved off the public portal route (`/api/customers/:uuid/top-ups`)
 * onto the authenticated customer route. The grid reads `data`/`totalRecords`
 * with the policy columns flattened onto each row.
 */
const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;
const POLICY_ID = 900;

const user = { sub: "user-1" } as unknown as JwtPayload;

function buildService(overrides: {
    topUpRows?: unknown[];
    topUpCount?: number;
    policy?: unknown;
    existingTopUp?: unknown;
} = {}) {
    const findMany = jest.fn().mockResolvedValue(overrides.topUpRows ?? []);
    const count = jest.fn().mockResolvedValue(overrides.topUpCount ?? 0);
    type WriteArgs = { data: Record<string, any> };
    const create = jest.fn(async ({ data }: WriteArgs) => ({ id: 1, ...data }));
    const update = jest.fn(async ({ data }: WriteArgs) => ({ id: 5, ...data }));
    const findFirstTopUp = jest
        .fn()
        .mockResolvedValue(overrides.existingTopUp ?? null);

    const db = {
        customer: {
            findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
        },
        insurancePolicy: {
            findFirst: jest.fn().mockResolvedValue(
                overrides.policy === undefined
                    ? { id: POLICY_ID, policy_kind: "TopUp" }
                    : overrides.policy
            ),
        },
        customerTopUp: {
            findMany,
            count,
            create,
            update,
            findFirst: findFirstTopUp,
        },
    } as unknown as DatabaseService;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
        isAdminAccount: jest.fn().mockReturnValue(true),
        hasPermission: jest.fn().mockResolvedValue(true),
    } as unknown as AccessScopeService;

    return {
        service: new CustomersService(db, accessScope),
        findMany,
        create,
        update,
    };
}

const validBody = {
    insurancePolicyId: POLICY_ID,
    topUpType: "Fixed",
    topUpValue: 5000,
    currency: "ILS",
    startDate: "2026-01-01",
    endDate: "2026-06-30",
};

describe("CustomersService top-ups", () => {
    describe("listTopUps", () => {
        it("flattens the policy columns onto each row", async () => {
            const { service } = buildService({
                topUpRows: [
                    {
                        id: 1,
                        top_up_value: 100,
                        InsurancePolicy: {
                            id: POLICY_ID,
                            policy_number: "TU-1",
                            insurer_name: "Acme Insure",
                        },
                    },
                ],
                topUpCount: 1,
            });

            const result = (await service.listTopUps(user, CUSTOMER_ID, {})) as {
                data: Record<string, unknown>[];
                totalRecords: number;
            };

            expect(result.totalRecords).toBe(1);
            expect(result.data[0]).toMatchObject({
                id: 1,
                policy_number: "TU-1",
                insurer_name: "Acme Insure",
            });
            expect(result.data[0].InsurancePolicy).toBeUndefined();
        });

        it("scopes to the customer and paginates", async () => {
            const { service, findMany } = buildService();

            await service.listTopUps(user, CUSTOMER_ID, {
                page: "3",
                limit: "20",
            });

            const args = findMany.mock.calls[0][0];
            expect(args.where.customer_id).toBe(CUSTOMER_ID);
            expect(args.skip).toBe(40);
            expect(args.take).toBe(20);
        });

        it("ignores an unknown sort field", async () => {
            const { service, findMany } = buildService();

            await service.listTopUps(user, CUSTOMER_ID, {
                sortField: "(select 1)",
                sortDirection: "asc",
            });

            expect(findMany.mock.calls[0][0].orderBy[0]).toEqual({
                start_date: "asc",
            });
        });

        it("searches notes and the linked policy", async () => {
            const { service, findMany } = buildService();

            await service.listTopUps(user, CUSTOMER_ID, { query: "acme" });

            expect(findMany.mock.calls[0][0].where.OR).toHaveLength(3);
        });
    });

    describe("createTopUp", () => {
        it("stores date-only fields at UTC midnight", async () => {
            const { service, create } = buildService();

            await service.createTopUp(user, CUSTOMER_ID, validBody);

            const data = create.mock.calls[0][0].data;
            expect(data.start_date.toISOString()).toBe(
                "2026-01-01T00:00:00.000Z"
            );
            expect(data.end_date.toISOString()).toBe("2026-06-30T00:00:00.000Z");
            expect(data.customer_id).toBe(CUSTOMER_ID);
            expect(data.created_by).toBe("user-1");
        });

        it("rejects an end date before the start date with the message the dialog matches", async () => {
            const { service } = buildService();

            await expect(
                service.createTopUp(user, CUSTOMER_ID, {
                    ...validBody,
                    endDate: "2025-12-31",
                })
            ).rejects.toMatchObject({
                response: { error: "endDate must be on or after startDate" },
            });
        });

        it("requires a currency for a fixed top-up", async () => {
            const { service } = buildService();

            await expect(
                service.createTopUp(user, CUSTOMER_ID, {
                    ...validBody,
                    currency: "  ",
                })
            ).rejects.toThrow();
        });

        it("allows a percentage top-up without a currency", async () => {
            const { service, create } = buildService();

            await service.createTopUp(user, CUSTOMER_ID, {
                ...validBody,
                topUpType: "Percentage",
                currency: null,
            });

            expect(create).toHaveBeenCalled();
        });

        it("rejects a non-positive value", async () => {
            const { service } = buildService();

            await expect(
                service.createTopUp(user, CUSTOMER_ID, {
                    ...validBody,
                    topUpValue: 0,
                })
            ).rejects.toThrow();
        });

        it("rejects a policy that is not a top-up policy", async () => {
            const { service } = buildService({
                policy: { id: POLICY_ID, policy_kind: "Primary" },
            });

            await expect(
                service.createTopUp(user, CUSTOMER_ID, validBody)
            ).rejects.toThrow();
        });

        it("rejects a policy outside the account", async () => {
            const { service } = buildService({ policy: null });

            await expect(
                service.createTopUp(user, CUSTOMER_ID, validBody)
            ).rejects.toThrow();
        });

        it("requires a premium currency when a premium is set", async () => {
            const { service } = buildService();

            await expect(
                service.createTopUp(user, CUSTOMER_ID, {
                    ...validBody,
                    premium: 250,
                })
            ).rejects.toThrow();
        });
    });

    describe("cancelTopUp", () => {
        it("stamps cancelled_at rather than deleting the row", async () => {
            const { service, update } = buildService({
                existingTopUp: { id: 5, cancelled_at: null },
            });

            await service.cancelTopUp(user, CUSTOMER_ID, 5);

            expect(update).toHaveBeenCalledTimes(1);
            expect(update.mock.calls[0][0].data.cancelled_at).toBeInstanceOf(
                Date
            );
        });

        it("is a no-op for an already cancelled top-up", async () => {
            const { service, update } = buildService({
                existingTopUp: { id: 5, cancelled_at: new Date() },
            });

            await service.cancelTopUp(user, CUSTOMER_ID, 5);

            expect(update).not.toHaveBeenCalled();
        });

        it("rejects a top-up belonging to another customer", async () => {
            const { service } = buildService({ existingTopUp: null });

            await expect(
                service.cancelTopUp(user, CUSTOMER_ID, 5)
            ).rejects.toThrow();
        });
    });
});
