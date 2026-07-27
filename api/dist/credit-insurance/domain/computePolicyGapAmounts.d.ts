import { Prisma } from "@prisma/client";
import type { OpenReceivableCurrencyBucket } from "./openReceivableByCustomerCurrency";
export type PolicyGapWritePayload = {
    capacity_gap_amount: number | null;
    capacity_gap_amount_date: Date | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};
export type ComputePolicyGapInput = {
    outdatedDcl: boolean;
    approvedLimit: Prisma.Decimal | null;
    approvedLimitCurrency: string | null;
    accountCurrency: string | null;
    openAr: number;
    currencyBuckets: OpenReceivableCurrencyBucket[];
    rateDate: Date;
    currencyRate?: {
        base_currency: string;
        other_currency: string;
        currency_ratio: number;
        rate_date: Date;
    } | null;
};
export type ComputePolicyGapResult = {
    missingRate: true;
    payload: null;
} | {
    missingRate: false;
    payload: PolicyGapWritePayload;
};
declare function nullGapPayload(): PolicyGapWritePayload;
export declare function computePolicyGapAmounts(input: ComputePolicyGapInput): ComputePolicyGapResult;
export { nullGapPayload };
