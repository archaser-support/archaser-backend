import {
    buildActiveCustomersChart,
    buildAudienceReportChart,
    buildAutomatedPhaseSplitChart,
    buildCollectionEffortsPhase,
    buildCollectionStat,
    buildAgingRangeRows,
    buildMaturityRows,
    buildTopEntityAmounts,
    reconstructDashboardFromCache,
} from "../src/system/financial-dashboard.builder";

describe("financial-dashboard.builder", () => {
    it("builds audienceReport with 6-month categories and two series", () => {
        const chart = buildAudienceReportChart(
            [1, 2, 3, 4, 5, 6],
            [10, 20, 30, 40, 50, 60],
            new Date(Date.UTC(2026, 6, 15))
        );
        expect(chart.options.xaxis.categories).toHaveLength(6);
        expect(chart.series).toHaveLength(2);
        expect(chart.series[0].data).toEqual([1, 2, 3, 4, 5, 6]);
        expect(chart.series[1].data).toEqual([10, 20, 30, 40, 50, 60]);
        // Symptom regression: empty series made Collected vs Promise blank.
        expect(chart.series[0].data.some((n) => n > 0)).toBe(true);
    });

    it("builds collection efforts phase percentages and stats", () => {
        const phase = buildCollectionEffortsPhase({
            Automated: 2,
            Agent: 2,
            Promise_to_pay: 0,
            Dispute: 0,
            Legal: 0,
        });
        expect(phase.series).toHaveLength(5);
        expect(phase.series.reduce((a, b) => a + b, 0)).toBe(100);
        expect(phase.stats.find((s) => s.label === "Automated")?.value).toBe(
            "2"
        );
        expect(phase.series.every((n) => typeof n === "number")).toBe(true);
    });

    it("builds collection stats used by Dispute & Promise cards", () => {
        const stat = buildCollectionStat("In Dispute", 3, 5, 1200.4, "ILS");
        expect(stat.label).toContain("Dispute");
        expect(stat.value[0].value).toBe("3");
        expect(stat.value[1].value).toBe("5");
        expect(stat.value[2].label).toBe("ILS");
        expect(stat.value[2].value).toBe("1200");
    });

    it("builds aging portfolio rows with percentages", () => {
        const rows = buildAgingRangeRows([
            { daysRange: "0_7", invoices: 1, accounts: 1, amount: 25 },
            { daysRange: "8_30", invoices: 1, accounts: 1, amount: 75 },
        ]);
        expect(rows).toHaveLength(2);
        expect(rows[1].amountPercentage).toBe("75%");
        expect(rows[1].progress).toBe(75);
    });

    it("ranks top entity amounts and scales percentages to the slices shown", () => {
        const slices = buildTopEntityAmounts(
            [
                { label: "Small", amount: 100 },
                { label: "Big", amount: 700 },
                { label: "Mid", amount: 200 },
            ],
            2
        );
        expect(slices.map((s) => s.customer)).toEqual(["Big", "Mid"]);
        // Percentages describe the donut, so the two kept slices total 100 even
        // though "Small" was dropped.
        expect(slices.map((s) => s.percentage)).toEqual([77.78, 22.22]);
        expect(slices[0].color).not.toBe(slices[1].color);
    });

    it("drops non-positive entity amounts rather than charting empty slices", () => {
        expect(
            buildTopEntityAmounts([
                { label: "Zero", amount: 0 },
                { label: "Credit", amount: -50 },
            ])
        ).toEqual([]);
    });

    it("builds maturity rows with two-decimal percentages", () => {
        const rows = buildMaturityRows([
            { daysRange: "0_7", invoices: 2, accounts: 1, amount: 600 },
            { daysRange: "8_30", invoices: 2, accounts: 2, amount: 4000 },
        ]);
        expect(rows[0].id).toBe(1);
        expect(rows[0].amountPercentage).toBe("13.04%");
        expect(rows[1].amountPercentage).toBe("86.96%");
    });

    it("keeps maturity percentages at zero when nothing is due", () => {
        const rows = buildMaturityRows([
            { daysRange: "0_7", invoices: 0, accounts: 0, amount: 0 },
        ]);
        expect(rows[0].amountPercentage).toBe("0.00%");
    });

    it("builds the added/removed customer series the dynamics chart reads", () => {
        const chart = buildActiveCustomersChart(
            [0, 0, 4, 2, 6, 0],
            [0, 0, 0, 0, 0, 11],
            new Date(Date.UTC(2026, 6, 15))
        );
        expect(chart.options.xaxis.categories).toHaveLength(6);
        expect(chart.series[0].name).toBe("Added Customers");
        expect(chart.series[0].data).toEqual([0, 0, 4, 2, 6, 0]);
        expect(chart.series[1].data).toEqual([0, 0, 0, 0, 0, 11]);
    });

    it("builds automated phase split categories and paired series", () => {
        const chart = buildAutomatedPhaseSplitChart([
            { label: "Step 0", customers: 12, invoices: 30 },
            { label: "Step 2", customers: 2, invoices: 4 },
        ]);
        expect(chart.options.xaxis.categories).toEqual(["Step 0", "Step 2"]);
        expect(chart.series[0].data).toEqual([12, 2]);
        expect(chart.series[1].data).toEqual([30, 4]);
    });

    it("reconstructs cached dashboard with non-empty charts", () => {
        const reconstructed = reconstructDashboardFromCache({
            active_customers: 10,
            overdue_amount: 100,
            overdue_invoices: 5,
            total_collected: 50,
            total_due: 20,
            due_today: 1,
            due_this_week: 2,
            due_this_month: 3,
            due_next_month: 4,
            receivables_schedule: [],
            invoices_by_customer: [],
            invoices_by_business_unit: [],
            overdue_invoices_by_customer: [],
            overdue_invoices_by_business_unit: [],
            chart_data: {
                audienceReport: {
                    options: { xaxis: { categories: ["Jan"] } },
                    series: [{ data: [9] }, { data: [8] }],
                },
                collectionEffortsPhase: {
                    series: [50, 50, 0, 0, 0],
                    stats: [{ label: "Automated", value: "1" }],
                },
                currency: "ILS",
                hasChildBusinessUnits: false,
            },
            aging_portfolio: { chartData: [{ daysRange: "0_7" }], details: [] },
            collection_stats: [
                buildCollectionStat("Agent", 1, 1, 10, "ILS"),
            ],
            last_calculated_at: new Date(),
            view_mode: "child",
        });

        expect(
            (reconstructed.audienceReport as { series: unknown[] }).series
                .length
        ).toBeGreaterThan(0);
        expect(
            (reconstructed.collectionEffortsPhase as { series: unknown[] })
                .series.length
        ).toBeGreaterThan(0);
        expect(
            (reconstructed.collectionStats as unknown[]).length
        ).toBeGreaterThan(0);
        expect(reconstructed.fromCache).toBe(true);
    });
});
