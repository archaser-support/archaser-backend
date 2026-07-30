import {
    buildAudienceReportChart,
    buildCollectionEffortsPhase,
    buildCollectionStat,
    buildAgingRangeRows,
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
