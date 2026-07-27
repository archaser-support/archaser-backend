import { prisma } from "@/lib/prisma";

import {
    ACCOUNT_CURRENCY,
    FX_BASE_USD_TO_ILS,
    FX_DRIFT_PCT,
} from "./constants";

const FX_ACTOR = "credit-reporting-sample-data";

/**
 * Deterministic USD→ILS spot with ±0.5% daily drift around 3.65.
 */
export function computeUsdToIlsRate(dayOffset: number): number {
    const wave = Math.sin((dayOffset + 1) * 0.37);
    const drift = wave * FX_DRIFT_PCT;
    return FX_BASE_USD_TO_ILS * (1 + drift);
}

/**
 * Stored as ILS base / USD other (matches production FX table convention).
 */
export function ilsPerUsdToStoredRatio(usdToIls: number): number {
    return 1 / usdToIls;
}

export async function upsertFxRateForDay(args: {
    rateDate: Date;
    dayOffset: number;
}): Promise<number> {
    const usdToIls = computeUsdToIlsRate(args.dayOffset);
    const currencyRatio = ilsPerUsdToStoredRatio(usdToIls);

    await prisma.currencyRate.upsert({
        where: {
            rate_date_base_currency_other_currency: {
                rate_date: args.rateDate,
                base_currency: ACCOUNT_CURRENCY,
                other_currency: "USD",
            },
        },
        update: {
            currency_ratio: currencyRatio,
            modified_by: FX_ACTOR,
        },
        create: {
            rate_date: args.rateDate,
            base_currency: ACCOUNT_CURRENCY,
            other_currency: "USD",
            currency_ratio: currencyRatio,
            created_by: FX_ACTOR,
            modified_by: FX_ACTOR,
        },
    });

    return usdToIls;
}

export function convertCustomerAmountToAccountCurrency(args: {
    customerAmount: number;
    invoiceCurrency: "ILS" | "USD";
    usdToIls: number;
}): number {
    if (args.invoiceCurrency === ACCOUNT_CURRENCY) {
        return args.customerAmount;
    }
    return args.customerAmount * args.usdToIls;
}
