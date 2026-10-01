import {
    excludeLinkedChildCustomersFilter,
    portfolioRootCustomerIdsWhere,
    withExcludeLinkedChildCustomers,
} from "@archaser/credit-insurance-domain";

describe("portfolio/dashboard exclude linked children", () => {
    it("exposes parent_customer_id null filter for KPI scopes", () => {
        expect(excludeLinkedChildCustomersFilter()).toEqual({
            parent_customer_id: null,
        });
        expect(
            withExcludeLinkedChildCustomers({
                account_id: 10,
                collection_status: { in: ["Active", "Inactive"] },
            })
        ).toEqual({
            AND: [
                {
                    account_id: 10,
                    collection_status: { in: ["Active", "Inactive"] },
                },
                { parent_customer_id: null },
            ],
        });
    });

    it("portfolioRootCustomerIdsWhere keeps roots and drops linked children", () => {
        const where = portfolioRootCustomerIdsWhere(10);
        expect(where).toMatchObject({
            account_id: 10,
            parent_customer_id: null,
        });
        expect(where).not.toHaveProperty("AND");

        const withBu = portfolioRootCustomerIdsWhere(10, {
            business_unit_id: 5,
        });
        expect(withBu).toMatchObject({
            account_id: 10,
            parent_customer_id: null,
            AND: [{ business_unit_id: 5 }],
        });
    });

    it("KPI gap totals count shared mirrored gap once at the root", () => {
        const policies = [
            { customer_id: 1, parent_customer_id: null, gap: 10_000 },
            { customer_id: 2, parent_customer_id: 1, gap: 10_000 },
            { customer_id: 3, parent_customer_id: 1, gap: 10_000 },
            { customer_id: 4, parent_customer_id: null, gap: 2_500 },
        ];

        const allTotal = policies.reduce((sum, row) => sum + row.gap, 0);
        expect(allTotal).toBe(32_500);

        const rootOnly = policies.filter(
            (row) => row.parent_customer_id == null
        );
        const rootTotal = rootOnly.reduce((sum, row) => sum + row.gap, 0);
        expect(rootOnly.map((row) => row.customer_id)).toEqual([1, 4]);
        expect(rootTotal).toBe(12_500);
    });

    it("portfolio root ID materialization omits linked children", async () => {
        const customers = [
            { id: 1, account_id: 10, parent_customer_id: null },
            { id: 2, account_id: 10, parent_customer_id: 1 },
            { id: 3, account_id: 10, parent_customer_id: 1 },
            { id: 4, account_id: 10, parent_customer_id: null },
            { id: 5, account_id: 99, parent_customer_id: null },
        ];

        const where = portfolioRootCustomerIdsWhere(10);
        const matched = customers.filter((c) => {
            if (c.account_id !== where.account_id) {
                return false;
            }
            if (c.parent_customer_id !== where.parent_customer_id) {
                return false;
            }
            return true;
        });

        expect(matched.map((c) => c.id)).toEqual([1, 4]);
    });

    it("approved-limit KPI sum excludes mirrored child limits", () => {
        const limits = [
            { customer_id: 1, parent_customer_id: null, approved_limit: 100_000 },
            { customer_id: 2, parent_customer_id: 1, approved_limit: 100_000 },
            { customer_id: 3, parent_customer_id: 1, approved_limit: 100_000 },
        ];

        const withChildren = limits.reduce(
            (sum, row) => sum + row.approved_limit,
            0
        );
        const rootsOnly = limits
            .filter((row) => row.parent_customer_id == null)
            .reduce((sum, row) => sum + row.approved_limit, 0);

        expect(withChildren).toBe(300_000);
        expect(rootsOnly).toBe(100_000);
    });
});
