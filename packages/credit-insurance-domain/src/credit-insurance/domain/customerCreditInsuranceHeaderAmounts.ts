import type { Customer } from "@prisma/client";

import { prisma } from "../domain-db";
import {
    deriveSecondaryAmountFromInvoiceBucketRatio,
    resolveCustomerCreditInsuranceSecondaryCurrency,
    resolveCustomerTotalArSecondaryFromInvoiceBuckets,
    resolveInvoiceBucketRatioArPair,
} from "./shared/invoiceBucketAmounts";

export {
    deriveSecondaryAmountFromInvoiceBucketRatio,
    resolveCustomerCreditInsuranceSecondaryCurrency,
    resolveCustomerTotalArSecondaryFromInvoiceBuckets,
    resolveInvoiceBucketRatioArPair,
};
export type { CustomerInvoiceCurrencyBuckets } from "./shared/invoiceBucketAmounts";

type LatestRateRatio = number | null;

const latestRateRatioCache = new Map<string, LatestRateRatio>();
const latestRateRatioInflight = new Map<string, Promise<LatestRateRatio>>();

function ratePairKey(from: string, to: string): string {
    return `${from}->${to}`;
}

async function loadLatestRateRatio(
    from: string,
    to: string
): Promise<LatestRateRatio> {
    const cacheKey = ratePairKey(from, to);
    if (latestRateRatioCache.has(cacheKey)) {
        return latestRateRatioCache.get(cacheKey) ?? null;
    }
    const inflight = latestRateRatioInflight.get(cacheKey);
    if (inflight) {
        return inflight;
    }
    const pending = (async (): Promise<LatestRateRatio> => {
        const direct = await prisma.currencyRate.findFirst({
            where: { base_currency: from, other_currency: to },
            orderBy: { rate_date: "desc" },
            select: { currency_ratio: true },
        });
        if (direct != null && typeof direct.currency_ratio === "number") {
            return direct.currency_ratio;
        }

        const inverse = await prisma.currencyRate.findFirst({
            where: { base_currency: to, other_currency: from },
            orderBy: { rate_date: "desc" },
            select: { currency_ratio: true },
        });
        if (
            inverse != null &&
            typeof inverse.currency_ratio === "number" &&
            inverse.currency_ratio !== 0
        ) {
            return 1 / inverse.currency_ratio;
        }
        return null;
    })();
    latestRateRatioInflight.set(cacheKey, pending);
    try {
        const ratio = await pending;
        latestRateRatioCache.set(cacheKey, ratio);
        return ratio;
    } finally {
        latestRateRatioInflight.delete(cacheKey);
    }
}

/** Convert `amount` in `fromCurrency` to `toCurrency` using the latest stored rate (either direction). */
export async function convertAmountToCurrencyLatestRate(
    fromCurrency: string,
    toCurrency: string,
    amount: number
): Promise<number | null> {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to || from === to) {
        return amount;
    }
    if (!Number.isFinite(amount)) {
        return null;
    }
    const ratio = await loadLatestRateRatio(from, to);
    if (ratio == null) {
        return null;
    }
    return amount * ratio;
}

// Re-export with Prisma Customer typing for server callers that relied on Pick<Customer, ...>
export type CustomerCreditInsuranceHeaderCustomer = Pick<
    Customer,
    | "customer_overdue_currency1"
    | "customer_overdue_currency2"
    | "customer_due_currency1"
    | "customer_due_currency2"
    | "customer_overdue_amount1"
    | "customer_overdue_amount2"
    | "customer_due_amount1"
    | "customer_due_amount2"
>;
