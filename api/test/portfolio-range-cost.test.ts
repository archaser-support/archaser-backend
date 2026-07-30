
import {
    computeActualSalesInvoiceCostSlice,
    computeLimitDayCostSlice,
    computePortfolioRangeCost,
    type PortfolioRangeCostDayRow,
} from "../src/credit-insurance/domain/portfolioRangeCost";

function approvedLimitDay(
    overrides: Partial<PortfolioRangeCostDayRow> &
        Pick<PortfolioRangeCostDayRow, "snapshotDate" | "customerId">
): PortfolioRangeCostDayRow {
    return {
        insurancePolicyId: 9,
        approvedLimit: 365_000,
        costCalculationMethod: "Limit",
        costPercent: 1,
        excludedFromPolicy: false,
        outdatedDcl: false,
        policyExclusionReason: null,
        ...overrides,
    };
}

function approvedSalesDay(
    overrides: Partial<PortfolioRangeCostDayRow> &
        Pick<PortfolioRangeCostDayRow, "snapshotDate" | "customerId">
): PortfolioRangeCostDayRow {
    return {
        insurancePolicyId: 9,
        approvedLimit: 100_000,
        costCalculationMethod: "ActualSales",
        costPercent: 2,
        excludedFromPolicy: false,
        outdatedDcl: false,
        policyExclusionReason: null,
        ...overrides,
    };
}

describe("computeLimitDayCostSlice", () => {
    it("uses (limit × cost %) / 100 / 365", () => {
        expect(
            computeLimitDayCostSlice({
                approvedLimit: 365_000,
                costPercent: 1,
                costCalculationMethod: "Limit",
            })
        ).toBeCloseTo(10, 8);
    });

    it("returns 0 when method or cost % is missing", () => {
        expect(
            computeLimitDayCostSlice({
                approvedLimit: 365_000,
                costPercent: null,
                costCalculationMethod: "Limit",
            })
        ).toBe(0);
        expect(
            computeLimitDayCostSlice({
                approvedLimit: 365_000,
                costPercent: 1,
                costCalculationMethod: null,
            })
        ).toBe(0);
        expect(
            computeLimitDayCostSlice({
                approvedLimit: 365_000,
                costPercent: 1,
                costCalculationMethod: "ActualSales",
            })
        ).toBe(0);
    });
});

describe("computeActualSalesInvoiceCostSlice", () => {
    it("uses (amount × cost %) / 100", () => {
        expect(
            computeActualSalesInvoiceCostSlice({
                amount: 10_000,
                costPercent: 2,
                costCalculationMethod: "ActualSales",
            })
        ).toBeCloseTo(200, 8);
    });

    it("returns 0 when method is not ActualSales or cost % missing", () => {
        expect(
            computeActualSalesInvoiceCostSlice({
                amount: 10_000,
                costPercent: 2,
                costCalculationMethod: "Limit",
            })
        ).toBe(0);
        expect(
            computeActualSalesInvoiceCostSlice({
                amount: 10_000,
                costPercent: null,
                costCalculationMethod: "ActualSales",
            })
        ).toBe(0);
    });
});

describe("computePortfolioRangeCost", () => {
    it("sums Limit day-slices with mid-range limit change", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedLimitDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
                approvedLimitDay({
                    snapshotDate: "2026-07-02",
                    customerId: 1,
                    approvedLimit: 730_000,
                    costPercent: 1,
                }),
            ],
            invoices: [],
            topUpSlices: [],
        });

        expect(result.periodCost).toBeCloseTo(30, 8);
        expect(result.monthly).toEqual([
            { month: "2026-07", totalCost: expect.closeTo(30, 8) },
        ]);
    });

    it("sums Actual Sales issued amounts including credit notes; excludes Draft/Void/Cancelled", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedSalesDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    costPercent: 2,
                }),
                approvedSalesDay({
                    snapshotDate: "2026-07-02",
                    customerId: 1,
                    costPercent: 2,
                }),
            ],
            invoices: [
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 9,
                    status: "Open",
                },
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: -1_000,
                    policyId: 9,
                    status: "Open",
                },
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 50_000,
                    policyId: 9,
                    status: "Draft",
                },
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 50_000,
                    policyId: 9,
                    status: "Void",
                },
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 50_000,
                    policyId: 9,
                    status: "Cancelled",
                },
                {
                    invoiceDate: "2026-07-02",
                    customerId: 1,
                    amount: 5_000,
                    policyId: 9,
                    status: "Paid",
                },
            ],
            topUpSlices: [],
        });

        // (10000 + -1000) * 2/100 + 5000 * 2/100 = 180 + 100 = 280
        expect(result.periodCost).toBeCloseTo(280, 8);
    });

    it("skips invoices when customer is not approved on issue day", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedSalesDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    policyExclusionReason: "Credit hold",
                }),
            ],
            invoices: [
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 9,
                    status: "Open",
                },
            ],
            topUpSlices: [],
        });

        expect(result.periodCost).toBe(0);
        expect(result.monthly).toEqual([]);
    });

    it("applies method flip by day / invoice date", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedLimitDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
                approvedSalesDay({
                    snapshotDate: "2026-07-02",
                    customerId: 1,
                    costPercent: 2,
                }),
            ],
            invoices: [
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 9,
                    status: "Open",
                },
                {
                    invoiceDate: "2026-07-02",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 9,
                    status: "Open",
                },
            ],
            topUpSlices: [],
        });

        // Limit day: 10; Actual Sales invoice on day2: 200; invoice on Limit day ignored
        expect(result.periodCost).toBeCloseTo(210, 8);
    });

    it("filters Actual Sales by invoice policy_id when policy filter set", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedSalesDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    costPercent: 1,
                }),
            ],
            invoices: [
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 9,
                    status: "Open",
                },
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 10_000,
                    policyId: 99,
                    status: "Open",
                },
            ],
            topUpSlices: [],
            policyId: 9,
        });

        expect(result.periodCost).toBeCloseTo(100, 8);
    });

    it("adds amortized top-up day slices into period and months", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedLimitDay({
                    snapshotDate: "2026-06-30",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
                approvedLimitDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
            ],
            invoices: [],
            topUpSlices: [
                { snapshotDate: "2026-06-30", amount: 3 },
                { snapshotDate: "2026-07-01", amount: 3 },
            ],
        });

        // Limit 10+10 + top-ups 3+3
        expect(result.periodCost).toBeCloseTo(26, 8);
        expect(result.monthly).toEqual([
            { month: "2026-06", totalCost: expect.closeTo(13, 8) },
            { month: "2026-07", totalCost: expect.closeTo(13, 8) },
        ]);
    });

    it("scopes monthly bars to calendar months with partial from/to edges", () => {
        const result = computePortfolioRangeCost({
            dayRows: [
                approvedLimitDay({
                    snapshotDate: "2026-06-30",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
                approvedLimitDay({
                    snapshotDate: "2026-07-01",
                    customerId: 1,
                    approvedLimit: 365_000,
                    costPercent: 1,
                }),
            ],
            invoices: [
                {
                    invoiceDate: "2026-07-01",
                    customerId: 1,
                    amount: 0,
                    policyId: 9,
                    status: "Open",
                },
            ],
            topUpSlices: [],
        });

        // Only days present in inputs (already clipped by fetch) contribute
        expect(result.monthly).toEqual([
            { month: "2026-06", totalCost: expect.closeTo(10, 8) },
            { month: "2026-07", totalCost: expect.closeTo(10, 8) },
        ]);
    });

    it("returns zero for empty inputs", () => {
        expect(
            computePortfolioRangeCost({
                dayRows: [],
                invoices: [],
                topUpSlices: [],
            })
        ).toEqual({ periodCost: 0, monthly: [] });
    });
});
