import { customersScopedForCreditDashboard } from "../src/credit-insurance/domain/customerPolicyQueryHelpers";
import {
    CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD,
    CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD,
    prepareDashboardCreditCustomerMarkers,
} from "../src/reports/dashboard-credit-customer-markers.util";

jest.mock(
    "../src/credit-insurance/domain/creditDashboardCustomerMembership",
    () => ({
        resolveCreditCustomerMembershipIds: jest.fn(),
        zeroLimitWarningMembershipWhere: jest.fn(() => ({
            CustomerPolicy: { some: { is_active: true, approved_limit: 0 } },
        })),
    })
);

const { resolveCreditCustomerMembershipIds } = jest.requireMock(
    "../src/credit-insurance/domain/creditDashboardCustomerMembership"
) as {
    resolveCreditCustomerMembershipIds: jest.Mock;
};

describe("prepareDashboardCreditCustomerMarkers", () => {
    beforeEach(() => {
        resolveCreditCustomerMembershipIds.mockReset();
    });

    it("expands scope marker to customersScopedForCreditDashboard", async () => {
        const prepared = await prepareDashboardCreditCustomerMarkers(
            [
                {
                    table: "Customer",
                    field: CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD,
                    operator: "equals",
                    value: "15",
                },
                {
                    table: "Customer",
                    field: "overdue_block",
                    operator: "equals",
                    value: true,
                },
            ],
            { accountId: 100 }
        );

        expect(prepared.filters).toEqual([
            {
                table: "Customer",
                field: "overdue_block",
                operator: "equals",
                value: true,
            },
        ]);
        expect(prepared.policyId).toBe(15);
        expect(prepared.primaryWhereExtras).toEqual(
            customersScopedForCreditDashboard(100, 15)
        );
    });

    it("expands capacity membership to id.in from getCapacityGapReport", async () => {
        resolveCreditCustomerMembershipIds.mockResolvedValue([10, 20]);

        const prepared = await prepareDashboardCreditCustomerMarkers(
            [
                {
                    table: "Customer",
                    field: CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD,
                    operator: "equals",
                    value: "all",
                },
                {
                    table: "Customer",
                    field: CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD,
                    operator: "equals",
                    value: "capacity",
                },
            ],
            { accountId: 55 }
        );

        expect(prepared.filters).toEqual([]);
        expect(prepared.membershipType).toBe("capacity");
        expect(prepared.primaryWhereExtras).toEqual({
            AND: [
                customersScopedForCreditDashboard(55, undefined),
                { id: { in: [10, 20] } },
            ],
        });
        expect(resolveCreditCustomerMembershipIds).toHaveBeenCalledWith(
            "capacity",
            55,
            expect.objectContaining({ policyId: undefined })
        );
    });

    it("parses top_up_expiring withinDays from membership value", async () => {
        resolveCreditCustomerMembershipIds.mockResolvedValue([1]);

        const prepared = await prepareDashboardCreditCustomerMarkers(
            [
                {
                    table: "Customer",
                    field: CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD,
                    operator: "equals",
                    value: "all",
                },
                {
                    table: "Customer",
                    field: CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD,
                    operator: "equals",
                    value: "top_up_expiring:45",
                },
            ],
            { accountId: 2 }
        );

        expect(prepared.membershipType).toBe("top_up_expiring");
        expect(prepared.withinDays).toBe(45);
        expect(resolveCreditCustomerMembershipIds).toHaveBeenCalledWith(
            "top_up_expiring",
            2,
            expect.objectContaining({ withinDays: 45 })
        );
    });
});
