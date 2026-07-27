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
export declare function resolveInvoiceLineOutstandingInAccountCurrency(row: OpenArInvoiceLine, accountCurrency: string): Promise<number>;
export declare function computeInvoiceLineOpenArInAccountCurrency(row: OpenArInvoiceLine, accountCurrency: string, convertedFromCustomerCurrency?: number | null): number;
export declare function fetchOpenReceivableByCustomerMapInAccountCurrency(accountId: number, accountCurrency: string, options?: {
    customerIds?: number[];
    policyId?: number;
    dbClient?: DbClient;
}): Promise<Map<number, number>>;
export declare function topOpenReceivableCurrencyBuckets(rows: CurrencyGroupedRow[], topN?: number): OpenReceivableCurrencyBucket[];
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
export declare function resolveCustomerHeaderOpenArAmounts(params: {
    accountId: number;
    customerId: number;
    accountCurrency: string | null | undefined;
    customer: CustomerHeaderOpenArCustomer;
    dbClient?: DbClient;
}): Promise<CustomerHeaderOpenArAmounts>;
export declare function fetchOpenReceivableTotalForCustomer(customerId: number, accountId: number, dbClient?: DbClient): Promise<number>;
export declare function fetchOpenReceivableForCustomer(accountId: number, customerId: number, policyId?: number | null, dbClient?: DbClient): Promise<number>;
export declare function fetchOpenReceivableCurrencyRowsForCustomer(customerId: number, accountId: number, dbClient?: DbClient): Promise<CurrencyGroupedRow[]>;
export declare function fetchOpenReceivableByCustomerMap(dbClient?: DbClient): Promise<Map<number, number>>;
export type OpenReceivableScope = {
    customerId: number;
    accountId: number;
    policyId?: number;
};
export declare function invoiceOpenReceivableWhere(scope: OpenReceivableScope): Prisma.InvoiceWhereInput;
export {};
