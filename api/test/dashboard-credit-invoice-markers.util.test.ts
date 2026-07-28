import {
    CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD,
    parseCreditDashboardInvoiceMembershipValue,
    prepareDashboardCreditInvoiceMarkers,
} from "../src/reports/dashboard-credit-invoice-markers.util";

jest.mock(
    "../src/credit-insurance/domain/creditDashboardInvoiceMembership",
    () => ({
        termsBreachMembershipWhere: jest.fn(
            (accountId: number, options: Record<string, unknown>) => ({
                account_id: accountId,
                status: { in: ["Due", "Overdue"] },
                OR: [{ reporting_breach: true }],
                ...(options.policyId != null
                    ? { policy_id: options.policyId }
                    : {}),
            })
        ),
        reportingCountdownMembershipWhere: jest.fn(
            (accountId: number, windowDays: number) => ({
                account_id: accountId,
                windowDays,
                actual_reporting_date: null,
            })
        ),
        reportedInvoicesMembershipWhere: jest.fn((accountId: number) => ({
            account_id: accountId,
            actual_reporting_date: { not: null },
        })),
        resolveReportingCountdownWindowDays: jest
            .fn()
            .mockResolvedValue(14),
    })
);

const {
    termsBreachMembershipWhere,
    reportingCountdownMembershipWhere,
    reportedInvoicesMembershipWhere,
    resolveReportingCountdownWindowDays,
} = jest.requireMock(
    "../src/credit-insurance/domain/creditDashboardInvoiceMembership"
) as {
    termsBreachMembershipWhere: jest.Mock;
    reportingCountdownMembershipWhere: jest.Mock;
    reportedInvoicesMembershipWhere: jest.Mock;
    resolveReportingCountdownWindowDays: jest.Mock;
};

describe("parseCreditDashboardInvoiceMembershipValue", () => {
    it("parses terms with overdue + reason", () => {
        expect(
            parseCreditDashboardInvoiceMembershipValue(
                "terms:overdue:reporting_breach"
            )
        ).toEqual({
            type: "terms",
            termsBreachReason: "reporting_breach",
            termsOverdueOnly: true,
        });
    });

    it("parses reporting and reported", () => {
        expect(parseCreditDashboardInvoiceMembershipValue("reporting")).toEqual(
            {
                type: "reporting",
                termsBreachReason: null,
                termsOverdueOnly: false,
            }
        );
        expect(parseCreditDashboardInvoiceMembershipValue("reported")).toEqual({
            type: "reported",
            termsBreachReason: null,
            termsOverdueOnly: false,
        });
    });
});

describe("prepareDashboardCreditInvoiceMarkers", () => {
    beforeEach(() => {
        termsBreachMembershipWhere.mockClear();
        reportingCountdownMembershipWhere.mockClear();
        reportedInvoicesMembershipWhere.mockClear();
        resolveReportingCountdownWindowDays.mockClear();
    });

    it("expands terms membership and strips policy/customer filters", async () => {
        const prepared = await prepareDashboardCreditInvoiceMarkers(
            [
                {
                    table: "Invoice",
                    field: CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD,
                    operator: "equals",
                    value: "terms:overdue:reporting_breach",
                },
                {
                    table: "Invoice",
                    field: "policy_id",
                    operator: "equals",
                    value: 9,
                },
            ],
            { accountId: 42 }
        );

        expect(prepared.filters).toEqual([]);
        expect(termsBreachMembershipWhere).toHaveBeenCalledWith(
            42,
            expect.objectContaining({
                termsBreachReason: "reporting_breach",
                termsOverdueOnly: true,
                policyId: 9,
            })
        );
        expect(prepared.primaryWhereExtras).toMatchObject({
            account_id: 42,
            policy_id: 9,
        });
    });

    it("expands reporting membership with account window days", async () => {
        const prepared = await prepareDashboardCreditInvoiceMarkers(
            [
                {
                    table: "Invoice",
                    field: CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD,
                    operator: "equals",
                    value: "reporting",
                },
            ],
            { accountId: 7 }
        );

        expect(resolveReportingCountdownWindowDays).toHaveBeenCalledWith(7);
        expect(reportingCountdownMembershipWhere).toHaveBeenCalledWith(
            7,
            14,
            expect.any(Object)
        );
        expect(prepared.primaryWhereExtras).toMatchObject({
            account_id: 7,
            windowDays: 14,
        });
    });

    it("expands reported membership", async () => {
        const prepared = await prepareDashboardCreditInvoiceMarkers(
            [
                {
                    table: "Invoice",
                    field: CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD,
                    operator: "equals",
                    value: "reported",
                },
            ],
            { accountId: 3 }
        );

        expect(reportedInvoicesMembershipWhere).toHaveBeenCalledWith(
            3,
            expect.any(Object)
        );
        expect(prepared.primaryWhereExtras).toMatchObject({
            account_id: 3,
            actual_reporting_date: { not: null },
        });
    });
});
