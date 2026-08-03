import type { cost_calculation_method, invoice_status } from "@prisma/client";
export declare const RANGE_COST_EXCLUDED_INVOICE_STATUSES: readonly invoice_status[];
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
export declare function computeLimitDayCostSlice(input: {
    approvedLimit: number | null;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
    excludedFromPolicy?: boolean;
    outdatedDcl?: boolean;
}): number;
/**
 * Actual Sales invoice slice: (issued amount × cost % as of issue day) / 100.
 */
export declare function computeActualSalesInvoiceCostSlice(input: {
    amount: number;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
}): number;
/**
 * Period + monthly portfolio range cost from Limit day-slices, Actual Sales
 * invoices, and amortized top-up day slices (approved customers only).
 */
export declare function computePortfolioRangeCost(input: {
    dayRows: PortfolioRangeCostDayRow[];
    invoices: PortfolioRangeCostInvoice[];
    topUpSlices: PortfolioRangeCostTopUpSlice[];
    /** When set, only invoices with matching `policyId` contribute. */
    policyId?: number;
}): PortfolioRangeCostResult;
