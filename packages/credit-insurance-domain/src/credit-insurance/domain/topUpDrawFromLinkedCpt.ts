import { longestBooleanStreakWindow } from "./shared/ctpDailySeries";
import { computeTopUpUsageMetrics } from "./invoiceCapacityGapAmounts";
import type { LinkedCptCustomerDayRow } from "./linkedCptCustomerDaySeries";

export type PortfolioTopUpDrawCustomer = {
    customerId: number;
    customerName: string;
    /** Policy limit on the peak-usage day. */
    policyLimit: number;
    /** Top-up cover on the peak-usage day. */
    topUpTotal: number;
    /** Usage amount on the peak-usage day. */
    peakUsageAmount: number;
    /** Top-up pool usage % on the peak day (0–n). */
    peakTopUpUsagePct: number | null;
    peakDate: string;
    /** Longest consecutive calendar streak of top-up draw days. */
    durationDays: number;
    /** Count of snapshot days the customer drew on top-up (may be 0). */
    daysUsed: number;
};

export type PortfolioTopUpDrawSection = {
    customerCount: number;
    averageDurationDays: number | null;
    customers: PortfolioTopUpDrawCustomer[];
};

export function isTopUpCoverDay(args: { topUpTotal: number }): boolean {
    return args.topUpTotal > 0;
}

export function isTopUpDrawDay(args: {
    approvedLimit: number;
    topUpTotal: number;
    usageAmount: number;
}): boolean {
    return (
        isTopUpCoverDay({ topUpTotal: args.topUpTotal }) &&
        args.usageAmount > args.approvedLimit
    );
}

type CustomerDay = {
    snapshotDate: string;
    approvedLimit: number;
    topUpTotal: number;
    usageAmount: number;
};

function finalizeCustomer(
    customerId: number,
    customerName: string,
    days: CustomerDay[]
): PortfolioTopUpDrawCustomer | null {
    const coverDays = days.filter((day) =>
        isTopUpCoverDay({ topUpTotal: day.topUpTotal })
    );
    if (coverDays.length === 0) {
        return null;
    }

    const usedDays = coverDays.filter((day) =>
        isTopUpDrawDay({
            approvedLimit: day.approvedLimit,
            topUpTotal: day.topUpTotal,
            usageAmount: day.usageAmount,
        })
    );

    let peak = coverDays[0];
    for (const day of coverDays) {
        if (
            day.usageAmount > peak.usageAmount ||
            (day.usageAmount === peak.usageAmount &&
                day.snapshotDate > peak.snapshotDate)
        ) {
            peak = day;
        }
    }

    const metrics = computeTopUpUsageMetrics({
        ar: peak.usageAmount,
        approvedLimit: peak.approvedLimit,
        topUpTotal: peak.topUpTotal,
    });
    const durationDays = longestBooleanStreakWindow(
        days.map((day) => ({
            snapshotDate: day.snapshotDate,
            flag: isTopUpDrawDay({
                approvedLimit: day.approvedLimit,
                topUpTotal: day.topUpTotal,
                usageAmount: day.usageAmount,
            }),
        })),
        true
    ).days;

    return {
        customerId,
        customerName,
        policyLimit: Math.max(0, peak.approvedLimit),
        topUpTotal: Math.max(0, peak.topUpTotal),
        peakUsageAmount: Math.max(0, peak.usageAmount),
        peakTopUpUsagePct: Math.min(999.99, metrics.topUpUsage * 100),
        peakDate: peak.snapshotDate,
        durationDays,
        daysUsed: usedDays.length,
    };
}

function compareTopUpDrawCustomers(
    a: PortfolioTopUpDrawCustomer,
    b: PortfolioTopUpDrawCustomer
): number {
    const overA = a.peakUsageAmount - (a.policyLimit + a.topUpTotal);
    const overB = b.peakUsageAmount - (b.policyLimit + b.topUpTotal);
    if (overB !== overA) {
        return overB - overA;
    }
    const intoA = a.peakUsageAmount - a.policyLimit;
    const intoB = b.peakUsageAmount - b.policyLimit;
    if (intoB !== intoA) {
        return intoB - intoA;
    }
    if (b.peakUsageAmount !== a.peakUsageAmount) {
        return b.peakUsageAmount - a.peakUsageAmount;
    }
    return a.customerName.localeCompare(b.customerName);
}

export function emptyTopUpDrawSection(): PortfolioTopUpDrawSection {
    return {
        customerCount: 0,
        averageDurationDays: null,
        customers: [],
    };
}

export function mapLinkedCptDaySeriesToTopUpDrawSection(
    dayRows: LinkedCptCustomerDayRow[]
): PortfolioTopUpDrawSection {
    const byCustomer = new Map<
        number,
        { customerName: string; days: CustomerDay[] }
    >();

    for (const row of dayRows) {
        let entry = byCustomer.get(row.customerId);
        if (!entry) {
            entry = { customerName: row.customerName, days: [] };
            byCustomer.set(row.customerId, entry);
        }
        entry.days.push({
            snapshotDate: row.snapshotDate,
            approvedLimit: row.approvedLimitSum,
            topUpTotal: row.topUpTotalSum,
            usageAmount: row.usageAmount,
        });
    }

    const customers: PortfolioTopUpDrawCustomer[] = [];
    for (const [customerId, entry] of byCustomer) {
        const row = finalizeCustomer(
            customerId,
            entry.customerName,
            entry.days
        );
        if (row) {
            customers.push(row);
        }
    }
    customers.sort(compareTopUpDrawCustomers);

    const durationEligible = customers.filter((row) => row.durationDays > 0);
    const durationSum = durationEligible.reduce(
        (sum, row) => sum + row.durationDays,
        0
    );
    return {
        customerCount: customers.length,
        averageDurationDays:
            durationEligible.length > 0
                ? durationSum / durationEligible.length
                : null,
        customers,
    };
}
