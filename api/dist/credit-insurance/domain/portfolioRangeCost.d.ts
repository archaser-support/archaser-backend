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
export declare function computeLimitDayCostSlice(input: {
    approvedLimit: number | null;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
    excludedFromPolicy?: boolean;
    outdatedDcl?: boolean;
}): number;
export declare function computeActualSalesInvoiceCostSlice(input: {
    amount: number;
    costPercent: number | null;
    costCalculationMethod: cost_calculation_method | null;
}): number;
export declare function computePortfolioRangeCost(input: {
    dayRows: PortfolioRangeCostDayRow[];
    invoices: PortfolioRangeCostInvoice[];
    topUpSlices: PortfolioRangeCostTopUpSlice[];
    policyId?: number;
}): PortfolioRangeCostResult;
