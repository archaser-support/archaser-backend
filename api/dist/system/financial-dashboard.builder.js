"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lastSixMonthLabels = lastSixMonthLabels;
exports.buildAudienceReportChart = buildAudienceReportChart;
exports.buildCollectionEffortsPhase = buildCollectionEffortsPhase;
exports.buildCollectionStat = buildCollectionStat;
exports.buildAgingRangeRows = buildAgingRangeRows;
exports.reconstructDashboardFromCache = reconstructDashboardFromCache;
const MONTH_NAMES = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];
function lastSixMonthLabels(now = new Date()) {
    const labels = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(MONTH_NAMES[d.getMonth()]);
    }
    return labels;
}
function buildAudienceReportChart(collectedData, promiseToPayData, now = new Date()) {
    const categories = lastSixMonthLabels(now);
    return {
        options: {
            chart: { type: "line", toolbar: { show: false } },
            xaxis: { categories },
            stroke: { width: [0, 3], curve: "smooth" },
            plotOptions: { bar: { columnWidth: "40%" } },
        },
        series: [
            { name: "Collected", type: "column", data: collectedData },
            { name: "Promise to Pay", type: "line", data: promiseToPayData },
        ],
    };
}
function buildCollectionEffortsPhase(counts) {
    const order = [
        "Automated",
        "Agent",
        "Promise_to_pay",
        "Dispute",
        "Legal",
    ];
    const labels = [
        "Automated",
        "Agent",
        "Promise to Pay",
        "Dispute",
        "Legal",
    ];
    const values = order.map((k) => counts[k] || 0);
    const total = values.reduce((s, n) => s + n, 0) || 1;
    const series = values.map((v) => Math.round((v / total) * 100));
    const stats = labels.map((label, i) => ({
        label,
        value: String(values[i]),
    }));
    return {
        options: { labels },
        series,
        stats,
    };
}
function buildCollectionStat(label, customers, invoices, amount, currency) {
    return {
        label,
        value: [
            { label: "Customers", value: String(customers) },
            { label: "Invoices", value: String(invoices) },
            { label: currency, value: String(Math.round(amount)) },
        ],
    };
}
function buildAgingRangeRows(buckets) {
    const totalAmount = buckets.reduce((s, b) => s + (b.amount || 0), 0) || 1;
    return buckets.map((b) => {
        const pct = Math.round(((b.amount || 0) / totalAmount) * 100);
        return {
            invoices: b.invoices,
            accounts: b.accounts,
            customers: b.accounts,
            amount: String(Math.round(b.amount || 0)),
            daysRange: b.daysRange,
            amountPercentage: `${pct}%`,
            progress: pct,
        };
    });
}
function reconstructDashboardFromCache(cached) {
    const chart = (cached.chart_data || {});
    return {
        activeCustomers: cached.active_customers,
        overdueAmount: cached.overdue_amount,
        overdueInvoices: cached.overdue_invoices,
        totalCollected: cached.total_collected,
        totalDue: cached.total_due,
        dueToday: cached.due_today,
        dueThisWeek: cached.due_this_week,
        dueThisMonth: cached.due_this_month,
        dueNextMonth: cached.due_next_month,
        receivablesMaturitySchedule: cached.receivables_schedule || [],
        invoicesByCustomer: cached.invoices_by_customer || [],
        invoicesByBusinessUnit: cached.invoices_by_business_unit || [],
        overdueInvoicesByCustomer: cached.overdue_invoices_by_customer || [],
        overdueInvoicesByBusinessUnit: cached.overdue_invoices_by_business_unit || [],
        audienceReport: chart.audienceReport || { options: {}, series: [] },
        activeCustomersChart: chart.activeCustomersChart || {
            options: {},
            series: [],
        },
        agingPortfolio: cached.aging_portfolio || {
            chartData: [],
            details: [],
        },
        collectionStats: cached.collection_stats || [],
        lastSynced: cached.last_calculated_at.toISOString(),
        collectionEffortsPhase: chart.collectionEffortsPhase || {
            options: {},
            series: [],
            stats: [],
        },
        automatedPhaseSplit: chart.automatedPhaseSplit || {
            options: {},
            series: [],
        },
        currency: chart.currency || "USD",
        viewMode: cached.view_mode,
        hasChildBusinessUnits: Boolean(chart.hasChildBusinessUnits),
        fromCache: true,
        cacheAge: Math.floor((Date.now() - cached.last_calculated_at.getTime()) / 1000),
    };
}
//# sourceMappingURL=financial-dashboard.builder.js.map