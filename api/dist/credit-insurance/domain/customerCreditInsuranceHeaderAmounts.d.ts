import type { Customer } from "@prisma/client";
import { deriveSecondaryAmountFromInvoiceBucketRatio, resolveCustomerCreditInsuranceSecondaryCurrency, resolveCustomerTotalArSecondaryFromInvoiceBuckets, resolveInvoiceBucketRatioArPair } from "./shared/invoiceBucketAmounts";
export { deriveSecondaryAmountFromInvoiceBucketRatio, resolveCustomerCreditInsuranceSecondaryCurrency, resolveCustomerTotalArSecondaryFromInvoiceBuckets, resolveInvoiceBucketRatioArPair, };
export type { CustomerInvoiceCurrencyBuckets } from "./shared/invoiceBucketAmounts";
export declare function convertAmountToCurrencyLatestRate(fromCurrency: string, toCurrency: string, amount: number): Promise<number | null>;
export type CustomerCreditInsuranceHeaderCustomer = Pick<Customer, "customer_overdue_currency1" | "customer_overdue_currency2" | "customer_due_currency1" | "customer_due_currency2" | "customer_overdue_amount1" | "customer_overdue_amount2" | "customer_due_amount1" | "customer_due_amount2">;
