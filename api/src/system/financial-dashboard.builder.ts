/**
 * Builds financial-dashboard chart/stat payloads expected by Amplify UI
 * (`DashboardResponse` / DashboardGrid).
 */

export type CollectionStatValue = {
    label: string;
    value: string | number | undefined;
};

export type CollectionStat = {
    label: string;
    value: Array<CollectionStatValue>;
};

export type PhaseStat = { label: string; value: string };

export type AgingRangeRow = {
    invoices: number;
    accounts: number;
    customers?: number;
    amount: string;
    daysRange: string;
    amountPercentage: string;
    progress: number;
};

/** A slice of an "amount by customer / business unit (Top 10)" bar+donut pair. */
export type EntityAmount = {
    customer: string;
    amount: number;
    percentage: number;
    color: string;
};

export type MaturityRow = {
    id: number;
    invoices: number;
    accounts: number;
    amount: number;
    daysRange: string;
    amountPercentage: string;
};

export type BucketTotals = {
    daysRange: string;
    invoices: number;
    accounts: number;
    amount: number;
};

/**
 * Palette the dashboard cache was written with. `AmountByEntityChart` re-colours
 * every slice from the account theme, so this only keeps freshly built payloads
 * shaped like cached ones.
 */
const ENTITY_COLORS = ["#6B46C1", "#9F7AEA", "#4A5568", "#718096"] as const;

const AXIS_TITLE_STYLE = {
    color: "#2F3B52",
    fontSize: "12px",
    fontWeight: 600,
} as const;

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
] as const;

export function lastSixMonthLabels(now = new Date()): string[] {
    const labels: string[] = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        labels.push(MONTH_NAMES[d.getMonth()]);
    }
    return labels;
}

export function buildAudienceReportChart(
    collectedData: number[],
    promiseToPayData: number[],
    now = new Date()
) {
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

export function buildCollectionEffortsPhase(
    counts: Record<
        "Automated" | "Agent" | "Promise_to_pay" | "Dispute" | "Legal",
        number
    >
) {
    const order = [
        "Automated",
        "Agent",
        "Promise_to_pay",
        "Dispute",
        "Legal",
    ] as const;
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
    const stats: PhaseStat[] = labels.map((label, i) => ({
        label,
        value: String(values[i]),
    }));
    return {
        options: { labels },
        series,
        stats,
    };
}

export function buildCollectionStat(
    label: string,
    customers: number,
    invoices: number,
    amount: number,
    currency: string
): CollectionStat {
    return {
        label,
        value: [
            { label: "Customers", value: String(customers) },
            { label: "Invoices", value: String(invoices) },
            { label: currency, value: String(Math.round(amount)) },
        ],
    };
}

export function buildAgingRangeRows(
    buckets: Array<{
        daysRange: string;
        invoices: number;
        accounts: number;
        amount: number;
    }>
): AgingRangeRow[] {
    const totalAmount =
        buckets.reduce((s, b) => s + (b.amount || 0), 0) || 1;
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

/**
 * Top-N slices for the "amount by entity" charts. Percentages are relative to
 * the slices actually returned, not to the account-wide total, so the donut adds
 * up to 100 rather than to whatever share the top N happen to represent.
 */
export function buildTopEntityAmounts(
    entries: Array<{ label: string; amount: number }>,
    limit = 10
): EntityAmount[] {
    const ranked = entries
        .filter((entry) => entry.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, limit);
    const total = ranked.reduce((sum, entry) => sum + entry.amount, 0);
    return ranked.map((entry, index) => ({
        customer: entry.label,
        amount: Math.round(entry.amount),
        percentage:
            total > 0 ? Math.round((entry.amount / total) * 10000) / 100 : 0,
        color: ENTITY_COLORS[index % ENTITY_COLORS.length],
    }));
}

/** Forward-looking counterpart of `buildAgingRangeRows` for the Due tab table. */
export function buildMaturityRows(buckets: BucketTotals[]): MaturityRow[] {
    const totalAmount = buckets.reduce(
        (sum, bucket) => sum + (bucket.amount || 0),
        0
    );
    return buckets.map((bucket, index) => {
        const pct =
            totalAmount > 0 ? ((bucket.amount || 0) / totalAmount) * 100 : 0;
        return {
            id: index + 1,
            invoices: bucket.invoices,
            accounts: bucket.accounts,
            amount: Math.round(bucket.amount || 0),
            daysRange: bucket.daysRange,
            amountPercentage: `${pct.toFixed(2)}%`,
        };
    });
}

/** "Overdue Accounts Dynamics": customers gained vs lost per month. */
export function buildActiveCustomersChart(
    addedData: number[],
    removedData: number[],
    now = new Date()
) {
    return {
        options: {
            chart: { type: "line" },
            xaxis: {
                categories: lastSixMonthLabels(now),
                title: { text: "Month", style: AXIS_TITLE_STYLE },
            },
            yaxis: { title: { text: "Customers", style: AXIS_TITLE_STYLE } },
        },
        series: [
            { name: "Added Customers", type: "column", data: addedData },
            { name: "Removed Customers", type: "line", data: removedData },
        ],
    };
}

/** Customers and invoices sitting on each step of the automated sequence. */
export function buildAutomatedPhaseSplitChart(
    steps: Array<{ label: string; customers: number; invoices: number }>
) {
    return {
        options: {
            chart: { type: "bar", stacked: false },
            xaxis: {
                categories: steps.map((step) => step.label),
                title: {
                    text: "Automated Collection Steps",
                    style: AXIS_TITLE_STYLE,
                },
            },
            yaxis: { title: { text: "Count", style: AXIS_TITLE_STYLE } },
        },
        series: [
            {
                name: "Customers",
                type: "column",
                data: steps.map((step) => step.customers),
            },
            {
                name: "Invoices",
                type: "column",
                data: steps.map((step) => step.invoices),
            },
        ],
    };
}

export function reconstructDashboardFromCache(cached: {
    active_customers: number;
    overdue_amount: number;
    overdue_invoices: number;
    total_collected: number;
    total_due: number;
    due_today: number;
    due_this_week: number;
    due_this_month: number;
    due_next_month: number;
    receivables_schedule: unknown;
    invoices_by_customer: unknown;
    invoices_by_business_unit: unknown;
    overdue_invoices_by_customer: unknown;
    overdue_invoices_by_business_unit: unknown;
    chart_data: Record<string, unknown> | null;
    aging_portfolio: unknown;
    collection_stats: unknown;
    last_calculated_at: Date;
    view_mode: string;
}): Record<string, unknown> {
    const chart = (cached.chart_data || {}) as Record<string, unknown>;
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
        overdueInvoicesByBusinessUnit:
            cached.overdue_invoices_by_business_unit || [],
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
        currency: (chart.currency as string) || "USD",
        viewMode: cached.view_mode,
        hasChildBusinessUnits: Boolean(chart.hasChildBusinessUnits),
        fromCache: true,
        cacheAge: Math.floor(
            (Date.now() - cached.last_calculated_at.getTime()) / 1000
        ),
    };
}
