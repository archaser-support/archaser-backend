import { SystemService } from "../src/system/system.service";

/**
 * These charts were served as hardcoded `[]` / `{ options: {}, series: [] }`
 * after the migration, so the dashboard rendered empty axes on accounts that
 * clearly had overdue debt. The assertions here are about the aggregations
 * actually running — a regression to a constant empty payload fails them.
 */

type AnyArgs = { where?: any; by?: any; _sum?: any };

const OVERDUE_BY_CUSTOMER = [
    { customer_id: 1, _sum: { outstanding_debt: 700 } },
    { customer_id: 2, _sum: { outstanding_debt: 200 } },
    { customer_id: 3, _sum: { outstanding_debt: 100 } },
];

const DUE_BY_CUSTOMER = [{ customer_id: 1, _sum: { outstanding_debt: 400 } }];

const CUSTOMERS = [
    {
        id: 1,
        Person: null,
        Company: { name: "Seaside & Co." },
        BusinessUnit: { id: 10, name: "Tax Law" },
    },
    {
        id: 2,
        Person: { full_name: "Dana Levi" },
        Company: null,
        BusinessUnit: { id: 10, name: "Tax Law" },
    },
    {
        id: 3,
        Person: null,
        Company: { name: "No Unit Ltd" },
        BusinessUnit: null,
    },
];

function buildDb() {
    const day = 24 * 60 * 60 * 1000;
    const today = new Date();
    return {
        dashboardCache: { findUnique: jest.fn().mockResolvedValue(null) },
        account: {
            findUnique: jest.fn().mockResolvedValue({ currency: "ILS" }),
        },
        invoice: {
            aggregate: jest
                .fn()
                .mockResolvedValue({ _sum: { outstanding_debt: 1000 } }),
            count: jest.fn().mockResolvedValue(3),
            // Both the overdue-customer count and the two entity breakdowns group
            // by customer_id; only the breakdowns ask for a sum.
            groupBy: jest.fn(async (args: AnyArgs) => {
                if (!args._sum?.outstanding_debt) {
                    return OVERDUE_BY_CUSTOMER.map((row) => ({
                        customer_id: row.customer_id,
                    }));
                }
                return args.where?.status === "Overdue"
                    ? OVERDUE_BY_CUSTOMER
                    : DUE_BY_CUSTOMER;
            }),
            // Aging looks backwards (`due_date.lt`), maturity forwards (`gte`).
            findMany: jest.fn(async (args: AnyArgs) => {
                if (args.where?.due_date?.gte) {
                    return [
                        {
                            customer_id: 1,
                            outstanding_debt: 600,
                            due_date: new Date(today.getTime() + 10 * day),
                        },
                        {
                            customer_id: 2,
                            outstanding_debt: 400,
                            due_date: new Date(today.getTime() + 40 * day),
                        },
                    ];
                }
                return [
                    {
                        customer_id: 1,
                        outstanding_debt: 900,
                        due_date: new Date(today.getTime() - 3 * day),
                    },
                ];
            }),
        },
        customer: {
            findMany: jest.fn().mockResolvedValue(CUSTOMERS),
            count: jest.fn(async (args: AnyArgs) =>
                args.where?.collection_status === "Active" ? 4 : 1
            ),
        },
        invoicePayment: {
            aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 500 } }),
        },
        customerDispute: {
            count: jest.fn().mockResolvedValue(2),
            groupBy: jest.fn().mockResolvedValue([{ customer_id: 1 }]),
        },
        disputeInvoice: { count: jest.fn().mockResolvedValue(1) },
        businessUnit: { count: jest.fn().mockResolvedValue(3) },
        customerCollectionPeriod: {
            aggregate: jest
                .fn()
                .mockResolvedValue({ _sum: { promise_to_pay_amount: 50 } }),
            groupBy: jest.fn(async (args: AnyArgs) => {
                if (args.by?.includes("last_automated_step")) {
                    return [
                        {
                            last_automated_step: 2,
                            _count: { _all: 2 },
                            _sum: { no_of_overdue_invoices: 4 },
                        },
                        {
                            last_automated_step: 0,
                            _count: { _all: 12 },
                            _sum: { no_of_overdue_invoices: 30 },
                        },
                    ];
                }
                return [
                    {
                        current_category: "Automated",
                        _count: { _all: 12 },
                        _sum: {
                            total_outstanding_amount: 900,
                            no_of_overdue_invoices: 30,
                            promise_to_pay_amount: 0,
                        },
                    },
                ];
            }),
        },
    };
}

function buildService() {
    const db = buildDb();
    const accessScope = {
        resolveUserInfo: jest.fn().mockResolvedValue({ id: "u1" }),
        getEffectiveAccountId: jest.fn().mockReturnValue(10117),
    };
    const service = new SystemService(db as never, accessScope as never);
    return { service, db };
}

describe("financial dashboard chart payloads", () => {
    const user = { sub: "u1" } as never;

    it("ranks overdue amount by customer instead of returning an empty chart", async () => {
        const { service } = buildService();
        const data: any = await service.getDashboard(user);

        expect(data.overdueInvoicesByCustomer).toHaveLength(3);
        expect(data.overdueInvoicesByCustomer[0]).toMatchObject({
            customer: "Seaside & Co.",
            amount: 700,
            percentage: 70,
        });
        // Person-backed customers resolve through full_name.
        expect(data.overdueInvoicesByCustomer[1].customer).toBe("Dana Levi");
    });

    it("rolls customers up into their business unit", async () => {
        const { service } = buildService();
        const data: any = await service.getDashboard(user);

        // Customer 3 has no unit, so the unit chart only carries the 900 that
        // customers 1 and 2 contribute.
        expect(data.overdueInvoicesByBusinessUnit).toEqual([
            expect.objectContaining({
                customer: "Tax Law",
                amount: 900,
                percentage: 100,
            }),
        ]);
    });

    it("serves the Due tab expected-invoice charts from future-dated invoices", async () => {
        const { service } = buildService();
        const data: any = await service.getDashboard(user);

        expect(data.invoicesByCustomer).toEqual([
            expect.objectContaining({ customer: "Seaside & Co.", amount: 400 }),
        ]);
        expect(data.invoicesByBusinessUnit).toEqual([
            expect.objectContaining({ customer: "Tax Law", amount: 400 }),
        ]);
    });

    it("buckets the maturity schedule by days remaining until due", async () => {
        const { service } = buildService();
        const data: any = await service.getDashboard(user);

        const rows = data.receivablesMaturitySchedule;
        expect(rows).toHaveLength(7);
        expect(rows.map((r: any) => r.daysRange)).toEqual([
            "0_7",
            "8_30",
            "31_60",
            "61_90",
            "91_180",
            "181_365",
            "365_2000",
        ]);
        expect(rows[1]).toMatchObject({ amount: 600, invoices: 1 });
        expect(rows[2]).toMatchObject({ amount: 400, invoices: 1 });
        expect(rows[0].amountPercentage).toBe("0.00%");
    });

    it("fills the customer dynamics and automated split charts", async () => {
        const { service } = buildService();
        const data: any = await service.getDashboard(user);

        expect(data.activeCustomersChart.options.xaxis.categories).toHaveLength(
            6
        );
        expect(data.activeCustomersChart.series[0].data).toEqual([
            4, 4, 4, 4, 4, 4,
        ]);
        expect(data.activeCustomersChart.series[1].data).toEqual([
            1, 1, 1, 1, 1, 1,
        ]);

        // Steps arrive unordered from groupBy and must be sorted for the axis.
        expect(data.automatedPhaseSplit.options.xaxis.categories).toEqual([
            "Step 0",
            "Step 2",
        ]);
        expect(data.automatedPhaseSplit.series[0].data).toEqual([12, 2]);
        expect(data.automatedPhaseSplit.series[1].data).toEqual([30, 4]);
    });

    it("returns empty entity charts when nothing is outstanding", async () => {
        const { service, db } = buildService();
        db.invoice.groupBy = jest.fn().mockResolvedValue([]);
        const data: any = await service.getDashboard(user);

        expect(data.overdueInvoicesByCustomer).toEqual([]);
        expect(data.overdueInvoicesByBusinessUnit).toEqual([]);
        // No customer lookup should be issued when there is nothing to rank.
        expect(db.customer.findMany).not.toHaveBeenCalled();
    });
});
