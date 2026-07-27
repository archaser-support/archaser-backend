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
export declare function sumStoredInvoiceCapacityGapRows(invoices: StoredInvoiceCapacityGapRow[]): {
    gapBase: number;
    gapLimit: number;
    hasMissingSnapshots: boolean;
};
export declare function computeStoredInvoiceCapacityGapFields(args: {
    row: InvoiceGapComputeInput;
    accountCurrency: string | null;
    currencyRate?: CurrencyRateRow | null;
    isOpenWithPolicy: boolean;
}): {
    capacity_gap_amount: number;
    capacity_gap_amount_limit: number;
};
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
export declare function aggregateImplicitBasePerLimitUnit(rows: ImplicitFxRow[]): number | null;
export declare function sumGapInSecondaryCurrencyFromInvoices(rows: GapFxRow[], secondaryCurrency: string): number | null;
export declare function fetchCustomerImplicitBasePerLimitUnit(accountId: number, customerId: number, limitCurrency: string, accountCurrency: string, options?: {
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number | null>;
export declare function fetchCustomerCapacityGapSecondaryFromContributingInvoices(accountId: number, customerId: number, secondaryCurrency: string, options?: {
    policyId?: number;
    dbClient?: DbClient;
}): Promise<number | null>;
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
