import { Prisma } from "@prisma/client";
import { type DbClient } from "../domain-db";
import { type CustomerInvoiceCurrencyBuckets } from "./shared/invoiceBucketAmounts";
export type OpenReceivableCurrencyBucket = {
    currency: string;
    openAr: number;
};
type CurrencyGroupedRow = {
    customer_currency: string | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
};
/**
 * Line outstanding for open Due/Overdue invoices (matches dashboard / FIFO rules).
 */
export declare function lineOutstandingFromAggregateRow(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number;
export type OpenArInvoiceLine = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
    customer_currency: string | null;
};
/**
 * One open invoice line total in account currency (policy usage / portfolio KPIs).
 * Prefers `outstanding_debt` (already in account currency). Only when that is zero
 * and invoice currency differs from account currency, uses FX on customer-currency amounts.
 */
/**
 * One invoice line outstanding in account currency (latest FX when needed).
 * Matches terms-breach / portfolio totals when customer currency differs.
 */
export declare function resolveInvoiceLineOutstandingInAccountCurrency(row: OpenArInvoiceLine, accountCurrency: string): Promise<number>;
export declare function computeInvoiceLineOpenArInAccountCurrency(row: OpenArInvoiceLine, accountCurrency: string, convertedFromCustomerCurrency?: number | null): number;
/**
 * Open Due/Overdue AR per customer summed in account currency (latest FX for foreign invoice currency).
 */
export declare function fetchOpenReceivableByCustomerMapInAccountCurrency(accountId: number, accountCurrency: string, options?: {
    customerIds?: number[];
    policyId?: number;
    dbClient?: DbClient;
}): Promise<Map<number, number>>;
/**
 * Group open Due/Overdue AR by invoice customer_currency, sort desc, take top N.
 * Same outstanding rule as CustomerService due aggregation.
 */
export declare function topOpenReceivableCurrencyBuckets(rows: CurrencyGroupedRow[], topN?: number): OpenReceivableCurrencyBucket[];
/** Open Due/Overdue receivable for one customer in invoice currency (customer-level, all policies). */
export declare function fetchOpenReceivableForCustomerByCurrency(accountId: number, customerId: number, currency: string, policyId?: number | null, dbClient?: DbClient): Promise<number>;
export type CustomerHeaderOpenArAmounts = {
    total_ar: number;
    total_ar_secondary: number | null;
    credit_insurance_secondary_currency: string | null;
};
export type CustomerHeaderOpenArCustomer = CustomerInvoiceCurrencyBuckets & {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
};
/**
 * Customer GET header open AR: FX-aware primary (account currency) and live
 * invoice-currency secondary with denormalized bucket fallback.
 */
export declare function resolveCustomerHeaderOpenArAmounts(params: {
    accountId: number;
    customerId: number;
    accountCurrency: string | null | undefined;
    customer: CustomerHeaderOpenArCustomer;
    dbClient?: DbClient;
}): Promise<CustomerHeaderOpenArAmounts>;
export declare function fetchOpenReceivableTotalForCustomer(customerId: number, accountId: number, dbClient?: DbClient): Promise<number>;
/** Open Due/Overdue AR for one customer, optionally scoped to a policy. */
export declare function fetchOpenReceivableForCustomer(accountId: number, customerId: number, policyId?: number | null, dbClient?: DbClient): Promise<number>;
export declare function fetchOpenReceivableCurrencyRowsForCustomer(customerId: number, accountId: number, dbClient?: DbClient): Promise<CurrencyGroupedRow[]>;
export declare function fetchOpenReceivableByCustomerMap(dbClient?: DbClient): Promise<Map<number, number>>;
export type OpenReceivableScope = {
    customerId: number;
    accountId: number;
    policyId?: number;
};
/** Optional policy_id filter for policy-scoped open AR (credit dashboard). */
export declare function invoiceOpenReceivableWhere(scope: OpenReceivableScope): Prisma.InvoiceWhereInput;
export {};
