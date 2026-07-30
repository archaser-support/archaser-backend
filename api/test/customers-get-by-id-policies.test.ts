import { CustomersService } from "../src/customers/customers.service";
import type { AccessScopeService } from "../src/auth/access-scope.service";
import type { DatabaseService } from "../src/database/database.service";
import type { JwtPayload } from "../src/auth/auth.service";

/**
 * The customer detail screen lists policy history from `customerPolicies` and
 * edits the row in `activeCustomerPolicy`. Prisma names the relation
 * `CustomerPolicy`, so `getById` has to publish both keys — when it does not,
 * the Policies tab renders an empty list and the Dashboard tab decides the
 * customer has no linked policy.
 */
const ACCOUNT_ID = 42;
const CUSTOMER_ID = 7;

const inactivePolicy = {
    id: 1,
    is_active: false,
    insurance_policy_id: 100,
    InsurancePolicy: { id: 100, policy_number: "POL-100" },
};
const activePolicy = {
    id: 2,
    is_active: true,
    insurance_policy_id: 200,
    InsurancePolicy: { id: 200, policy_number: "POL-200" },
};

function buildService(policies: unknown[]) {
    const findFirst = jest.fn().mockResolvedValue({
        id: CUSTOMER_ID,
        account_id: ACCOUNT_ID,
        customer_name: "Acme",
        CustomerPolicy: policies,
    });

    const db = {
        customer: {
            findUnique: jest.fn().mockResolvedValue({
                id: CUSTOMER_ID,
                account_id: ACCOUNT_ID,
                owner_id: null,
                business_unit_id: null,
            }),
            findFirst,
        },
    } as unknown as DatabaseService;

    const accessScope = {
        resolveUserInfo: jest
            .fn()
            .mockResolvedValue({ accountId: ACCOUNT_ID, role: "Admin" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(ACCOUNT_ID),
        isAdminAccount: jest.fn().mockReturnValue(true),
        hasPermission: jest.fn().mockResolvedValue(true),
        getEffectiveUserId: jest.fn().mockReturnValue("user-1"),
    } as unknown as AccessScopeService;

    return {
        service: new CustomersService(db, accessScope),
        findFirst,
    };
}

const user = { sub: "user-1" } as unknown as JwtPayload;

describe("CustomersService.getById policy relation", () => {
    it("requests the policy relation with its insurance policy", async () => {
        const { service, findFirst } = buildService([activePolicy]);

        await service.getById(user, CUSTOMER_ID);

        const include = findFirst.mock.calls[0][0].include;
        expect(include.CustomerPolicy).toBeDefined();
        expect(include.CustomerPolicy.include.InsurancePolicy).toBe(true);
    });

    it("exposes history under customerPolicies, active row first", async () => {
        const { service } = buildService([activePolicy, inactivePolicy]);

        const result = (await service.getById(user, CUSTOMER_ID)) as Record<
            string,
            unknown
        >;

        expect(result.customerPolicies).toHaveLength(2);
        expect(result.activeCustomerPolicy).toMatchObject({
            id: activePolicy.id,
            insurance_policy_id: 200,
        });
        // The frontend resolves the effective policy id from this key, so a
        // PascalCase-only payload would leave the tabs empty.
        expect(result.CustomerPolicy).toBeUndefined();
    });

    it("reports no active policy when every row is inactive", async () => {
        const { service } = buildService([inactivePolicy]);

        const result = (await service.getById(user, CUSTOMER_ID)) as Record<
            string,
            unknown
        >;

        expect(result.customerPolicies).toHaveLength(1);
        expect(result.activeCustomerPolicy).toBeNull();
    });

    it("returns an empty history for a customer with no policies", async () => {
        const { service } = buildService([]);

        const result = (await service.getById(user, CUSTOMER_ID)) as Record<
            string,
            unknown
        >;

        expect(result.customerPolicies).toEqual([]);
        expect(result.activeCustomerPolicy).toBeNull();
    });
});
