import { Prisma } from "@prisma/client";
import { type DbClient } from "../domain-db";
export type CurrencyRateRow = {
    base_currency: string;
    other_currency: string;
    currency_ratio: number;
    rate_date: Date;
};
export type InvoiceGapComputeInput = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    limit_assessed_amount: number | null;
    limit_assessed_currency: string | null;
};
export type StoredInvoiceCapacityGapRow = {
    capacity_gap_amount?: number | Prisma.Decimal | null;
    capacity_gap_amount_limit?: number | Prisma.Decimal | null;
    limit_assessed_amount?: number | Prisma.Decimal | null;
};
/**
 * Sum persisted per-invoice gap fields — same rollup as
 * {@link sumInvoiceCapacityGapForCustomerPolicy} without a DB round-trip.
 */
export declare function sumStoredInvoiceCapacityGapRows(invoices: StoredInvoiceCapacityGapRow[]): {
    gapBase: number;
    gapLimit: number;
    hasMissingSnapshots: boolean;
};
/**
 * Per-invoice gap fields using the same rules as
 * {@link syncInvoiceCapacityGapAmountsForCustomer}.
 */
export declare function computeStoredInvoiceCapacityGapFields(args: {
    row: InvoiceGapComputeInput;
    accountCurrency: string | null;
    currencyRate?: CurrencyRateRow | null;
    isOpenWithPolicy: boolean;
}): {
    capacity_gap_amount: number;
    capacity_gap_amount_limit: number;
};
/**
 * Implicit FX ratio: account base per one unit of customer/invoice currency.
 * Returns null when both sides are not present with the same sign.
 */
export declare function invoiceImplicitBasePerCustomerUnit(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number | null;
type ImplicitFxRow = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
};
type GapFxRow = {
    capacity_gap_amount: Prisma.Decimal | number | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    customer_currency: string | null;
};
/**
 * Portfolio implicit FX: account base per one unit of limit/invoice currency,
 * aggregated from open invoice outstanding fields (same basis as capacity gap).
 */
export declare function aggregateImplicitBasePerLimitUnit(rows: ImplicitFxRow[]): number | null;
/**
 * Secondary gap amount from contributing invoices only.
 * Uses weighted implicit invoice FX on rows with positive capacity gap.
 */
export declare function sumGapInSecondaryCurrencyFromInvoices(rows: GapFxRow[], secondaryCurrency: string): number | null;
/** Implicit FX from a customer's open invoices in limit currency (falls back to null). */
export declare function fetchCustomerImplicitBasePerLimitUnit(accountId: number, customerId: number, limitCurrency: string, accountCurrency: string, options?: {
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number | null>;
export declare function fetchCustomerCapacityGapSecondaryFromContributingInvoices(accountId: number, customerId: number, secondaryCurrency: string, options?: {
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number | null>;
/** Approved limit in account currency for gap capping (implicit invoice FX first). */
export declare function resolveApprovedLimitInAccountCurrency(accountId: number, customerId: number, policyId: number, approvedLimit: number, limitCurrency: string | null | undefined, accountCurrency: string | null | undefined, dbClient?: DbClient): Promise<number>;
export declare function computeInvoiceCapacityGapDualCurrency(args: {
    row: InvoiceGapComputeInput;
    accountCurrency: string | null;
    currencyRate?: CurrencyRateRow | null;
}): {
    gapLimit: number;
    gapBase: number | null;
    rateDate: Date | null;
    usedImplicitRate: boolean;
    missingRate: boolean;
};
export type InvoiceStoredGapRow = {
    capacity_gap_amount: Prisma.Decimal | number | null;
    capacity_gap_amount_limit: Prisma.Decimal | number | null;
    limit_assessed_amount: Prisma.Decimal | number | null;
};
/** Sum stored invoice gap fields for one customer + primary policy (writer / reconciliation). */
export declare function sumInvoiceCapacityGapForCustomerPolicy(accountId: number, customerId: number, policyId: number, dbClient?: DbClient): Promise<{
    gapBase: number;
    gapLimit: number;
    limitCurrency: string | null;
    hasMissingSnapshots: boolean;
    missingRate: boolean;
}>;
export type CustomerPolicyGapAggregateRow = {
    customer_id: number;
    insurance_policy_id: number | null;
    is_active: boolean;
    capacity_gap_amount: number | null;
    capacity_gap_amount1: number | null;
};
/** Portfolio read: SUM synced CustomerPolicy gap fields (D9). */
export declare function sumCustomerPolicyCapacityGapForAccount(accountId: number, options?: {
    policyId?: number;
    businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
    dbClient?: DbClient;
}): Promise<{
    gapBaseTotal: number;
    customerOverLimitCount: number;
    gapByPolicyId: Map<number, number>;
    gapByCustomerPolicy: Map<string, number>;
}>;
/**
 * Sheet 2 usage metrics: policy / top-up / effective utilization.
 * When top-up is active and AR exceeds policy limit, policy usage caps at 100%.
 * Top-up usage is (AR − limit) / topUpTotal and may exceed 100%.
 */
export declare function computeTopUpUsageMetrics(args: {
    ar: number;
    approvedLimit: number;
    topUpTotal: number;
}): {
    policyUsage: number;
    topUpUsage: number;
    effectiveUsage: number;
};
export {};
