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

type FrankfurterLatestResponse = {
    rates?: Record<string, number>;
};

/**
 * Live ECB-backed spot (same source as cron). Used when `CurrencyRate` has no row
 * for pairs like ILS→GBP (cron only stores limit→account policy pairs).
 */
async function fetchFrankfurterCrossRate(
    fromCurrency: string,
    toCurrency: string
): Promise<number | null> {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to || from === to) {
        return 1;
    }
    try {
        const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) {
            return null;
        }
        const payload = (await response.json()) as FrankfurterLatestResponse;
        const r = payload.rates?.[to];
        if (typeof r !== "number" || !Number.isFinite(r) || r === 0) {
            return null;
        }
        return r;
    } catch {
        return null;
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

    const direct = await prisma.currencyRate.findFirst({
        where: { base_currency: from, other_currency: to },
        orderBy: { rate_date: "desc" },
        select: { currency_ratio: true },
    });
    if (direct != null && typeof direct.currency_ratio === "number") {
        return amount * direct.currency_ratio;
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
        return amount / inverse.currency_ratio;
    }

    const directLive = await fetchFrankfurterCrossRate(from, to);
    if (directLive != null) {
        return amount * directLive;
    }
    const inverseLive = await fetchFrankfurterCrossRate(to, from);
    if (inverseLive != null && inverseLive !== 0) {
        return amount / inverseLive;
    }

    return null;
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
