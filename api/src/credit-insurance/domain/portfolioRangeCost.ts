import type { cost_calculation_method, invoice_status } from "@prisma/client";

import { normalizePolicyExclusionReason } from "@archaser/credit-insurance-domain";

export const RANGE_COST_EXCLUDED_INVOICE_STATUSES: readonly invoice_status[] = [
    "Draft",
    "Void",
    "Cancelled",
];

const EXCLUDED_INVOICE_STATUS_SET = new Set<string>(
    RANGE_COST_EXCLUDED_INVOICE_STATUSES
);

function isApprovedOnDay(input: {
    hasLinkedPolicy: boolean;
    exclusionReason: unknown;
}): boolean {
    if (!input.hasLinkedPolicy) {
        return false;
    }
    return !normalizePolicyExclusionReason(input.exclusionReason);
}
export type PortfolioRangeCostDayRow = {
    snapshotDate: string;
    customerId: number;
    insurancePolicyId: number | null;
    approvedLimit: number | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: number | null;
    excludedFromPolicy: boolean;
    outdatedDcl: boolean;
    policyExclusionReason: string | null;
};

export type PortfolioRangeCostInvoice = {
    invoiceDate: string;
    customerId: number;
    amount: number;
    policyId: number | null;
    status: invoice_status | string;
};

export type PortfolioRangeCostTopUpSlice = {
    snapshotDate: string;
    amount: number;
};

export type PortfolioRangeCostMonthlyPoint = {
    month: string;
    totalCost: number;
};

export type PortfolioRangeCostResult = {
    periodCost: number;
    monthly: PortfolioRangeCostMonthlyPoint[];
};

/**
 * Limit day slice: (approved limit × cost %) / 100 / 365.
 * Missing method/cost %/limit, non-Limit method, or excluded/outdated → 0.
 */
export function computeLimitDayCostSlice(input: {
    approvedLimit: number | null;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
    excludedFromPolicy?: boolean;
    outdatedDcl?: boolean;
}): number {
    if (input.excludedFromPolicy || input.outdatedDcl) {
        return 0;
    }
    if (input.costCalculationMethod !== "Limit") {
        return 0;
    }
    if (
        input.approvedLimit == null ||
        input.costPercent == null ||
        !Number.isFinite(input.approvedLimit) ||
        !Number.isFinite(input.costPercent) ||
        input.approvedLimit <= 0
    ) {
        return 0;
    }
    return (input.approvedLimit * input.costPercent) / 100 / 365;
}

/**
 * Actual Sales invoice slice: (issued amount × cost % as of issue day) / 100.
 */
export function computeActualSalesInvoiceCostSlice(input: {
    amount: number;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
}): number {
    if (input.costCalculationMethod !== "ActualSales") {
        return 0;
    }
    if (
        input.costPercent == null ||
        !Number.isFinite(input.costPercent) ||
        !Number.isFinite(input.amount)
    ) {
        return 0;
    }
    return (input.amount * input.costPercent) / 100;
}

function addToMonthBucket(
    buckets: Map<string, number>,
    ymd: string,
    amount: number
): void {
    if (!Number.isFinite(amount) || amount === 0) {
        return;
    }
    const month = ymd.slice(0, 7);
    buckets.set(month, (buckets.get(month) ?? 0) + amount);
}

function dayKey(customerId: number, snapshotDate: string): string {
    return `${customerId}|${snapshotDate}`;
}

/**
 * Period + monthly portfolio range cost from Limit day-slices, Actual Sales
 * invoices, and amortized top-up day slices (approved customers only).
 */
export function computePortfolioRangeCost(input: {
    dayRows: PortfolioRangeCostDayRow[];
    invoices: PortfolioRangeCostInvoice[];
    topUpSlices: PortfolioRangeCostTopUpSlice[];
    /** When set, only invoices with matching `policyId` contribute. */
    policyId?: number;
}): PortfolioRangeCostResult {
    const monthBuckets = new Map<string, number>();
    let periodCost = 0;

    const dayByCustomerDate = new Map<string, PortfolioRangeCostDayRow>();
    for (const row of input.dayRows) {
        dayByCustomerDate.set(dayKey(row.customerId, row.snapshotDate), row);

        const approved = isApprovedOnDay({
            hasLinkedPolicy: row.insurancePolicyId != null,
            exclusionReason: row.policyExclusionReason,
        });
        if (!approved) {
            continue;
        }

        const limitCost = computeLimitDayCostSlice({
            approvedLimit: row.approvedLimit,
            costPercent: row.costPercent,
            costCalculationMethod: row.costCalculationMethod,
            excludedFromPolicy: row.excludedFromPolicy,
            outdatedDcl: row.outdatedDcl,
        });
        if (limitCost !== 0) {
            periodCost += limitCost;
            addToMonthBucket(monthBuckets, row.snapshotDate, limitCost);
        }
    }

    for (const invoice of input.invoices) {
        if (EXCLUDED_INVOICE_STATUS_SET.has(String(invoice.status))) {
            continue;
        }
        if (
            input.policyId != null &&
            invoice.policyId !== input.policyId
        ) {
            continue;
        }
        if (invoice.customerId == null) {
            continue;
        }

        const dayRow = dayByCustomerDate.get(
            dayKey(invoice.customerId, invoice.invoiceDate)
        );
        if (dayRow == null) {
            continue;
        }

        const approved = isApprovedOnDay({
            hasLinkedPolicy: dayRow.insurancePolicyId != null,
            exclusionReason: dayRow.policyExclusionReason,
        });
        if (!approved) {
            continue;
        }
        if (dayRow.excludedFromPolicy || dayRow.outdatedDcl) {
            continue;
        }

        const salesCost = computeActualSalesInvoiceCostSlice({
            amount: invoice.amount,
            costPercent: dayRow.costPercent,
            costCalculationMethod: dayRow.costCalculationMethod,
        });
        if (salesCost !== 0) {
            periodCost += salesCost;
            addToMonthBucket(monthBuckets, invoice.invoiceDate, salesCost);
        }
    }

    for (const slice of input.topUpSlices) {
        if (!Number.isFinite(slice.amount) || slice.amount === 0) {
            continue;
        }
        periodCost += slice.amount;
        addToMonthBucket(monthBuckets, slice.snapshotDate, slice.amount);
    }

    const monthly = Array.from(monthBuckets.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, totalCost]) => ({ month, totalCost }));

    return { periodCost, monthly };
}
