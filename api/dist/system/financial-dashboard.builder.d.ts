export type CollectionStatValue = {
    label: string;
    value: string | number | undefined;
};
export type CollectionStat = {
    label: string;
    value: Array<CollectionStatValue>;
};
export type PhaseStat = {
    label: string;
    value: string;
};
export type AgingRangeRow = {
    invoices: number;
    accounts: number;
    customers?: number;
    amount: string;
    daysRange: string;
    amountPercentage: string;
    progress: number;
};
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
export declare function lastSixMonthLabels(now?: Date): string[];
export declare function buildAudienceReportChart(collectedData: number[], promiseToPayData: number[], now?: Date): {
    options: {
        chart: {
            type: string;
            toolbar: {
                show: boolean;
            };
        };
        xaxis: {
            categories: string[];
        };
        stroke: {
            width: number[];
            curve: string;
        };
        plotOptions: {
            bar: {
                columnWidth: string;
            };
        };
    };
    series: {
        name: string;
        type: string;
        data: number[];
    }[];
};
export declare function buildCollectionEffortsPhase(counts: Record<"Automated" | "Agent" | "Promise_to_pay" | "Dispute" | "Legal", number>): {
    options: {
        labels: string[];
    };
    series: number[];
    stats: PhaseStat[];
};
export declare function buildCollectionStat(label: string, customers: number, invoices: number, amount: number, currency: string): CollectionStat;
export declare function buildAgingRangeRows(buckets: Array<{
    daysRange: string;
    invoices: number;
    accounts: number;
    amount: number;
}>): AgingRangeRow[];
export declare function buildTopEntityAmounts(entries: Array<{
    label: string;
    amount: number;
}>, limit?: number): EntityAmount[];
export declare function buildMaturityRows(buckets: BucketTotals[]): MaturityRow[];
export declare function buildActiveCustomersChart(addedData: number[], removedData: number[], now?: Date): {
    options: {
        chart: {
            type: string;
        };
        xaxis: {
            categories: string[];
            title: {
                text: string;
                style: {
                    readonly color: "#2F3B52";
                    readonly fontSize: "12px";
                    readonly fontWeight: 600;
                };
            };
        };
        yaxis: {
            title: {
                text: string;
                style: {
                    readonly color: "#2F3B52";
                    readonly fontSize: "12px";
                    readonly fontWeight: 600;
                };
            };
        };
    };
    series: {
        name: string;
        type: string;
        data: number[];
    }[];
};
export declare function buildAutomatedPhaseSplitChart(steps: Array<{
    label: string;
    customers: number;
    invoices: number;
}>): {
    options: {
        chart: {
            type: string;
            stacked: boolean;
        };
        xaxis: {
            categories: string[];
            title: {
                text: string;
                style: {
                    readonly color: "#2F3B52";
                    readonly fontSize: "12px";
                    readonly fontWeight: 600;
                };
            };
        };
        yaxis: {
            title: {
                text: string;
                style: {
                    readonly color: "#2F3B52";
                    readonly fontSize: "12px";
                    readonly fontWeight: 600;
                };
            };
        };
    };
    series: {
        name: string;
        type: string;
        data: number[];
    }[];
};
export declare function reconstructDashboardFromCache(cached: {
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
}): Record<string, unknown>;
