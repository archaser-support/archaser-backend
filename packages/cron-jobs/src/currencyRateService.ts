type CurrencyPair = {
    baseCurrency: string;
    otherCurrency: string;
};

type FrankfurterResponse = {
    date: string;
    rates: Record<string, number>;
};

function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
}

function normalizeCurrency(code: string | null | undefined): string | null {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}

async function getDistinctCurrencyPairs(
    prisma: import("@prisma/client").PrismaClient
): Promise<CurrencyPair[]> {
    const activePolicyCurrencyRows = await prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            approved_limit_currency: { not: null },
            approved_limit: { not: null },
            Customer: {
                collection_status: "Active",
                Account: {
                    has_credit_insurance: true,
                    currency: { not: null },
                },
            },
        },
        select: {
            approved_limit_currency: true,
            Customer: {
                select: {
                    account_id: true,
                    Account: { select: { currency: true } },
                },
            },
        },
    });
    const cardRows = await prisma.customer.findMany({
        where: {
            collection_status: "Active",
            Account: {
                has_credit_insurance: true,
                currency: { not: null },
            },
        },
        select: {
            Account: { select: { currency: true } },
            customer_due_currency1: true,
            customer_due_currency2: true,
            customer_overdue_currency1: true,
            customer_overdue_currency2: true,
            customer_due_amount1: true,
            customer_due_amount2: true,
            customer_overdue_amount1: true,
            customer_overdue_amount2: true,
        },
    });

    const uniquePairs = new Set<string>();
    const addPair = (baseCurrency: string | null, otherCurrency: string | null) => {
        if (!baseCurrency || !otherCurrency || baseCurrency === otherCurrency) {
            return;
        }
        uniquePairs.add(`${baseCurrency}->${otherCurrency}`);
    };
    for (const row of activePolicyCurrencyRows) {
        const baseCurrency = normalizeCurrency(row.approved_limit_currency);
        const otherCurrency = normalizeCurrency(
            row.Customer.Account.currency
        );
        addPair(baseCurrency, otherCurrency);
    }
    for (const row of cardRows) {
        const accountCurrency = normalizeCurrency(row.Account.currency);
        const candidates: Array<{ currency: string | null | undefined; amount: number }> = [
            {
                currency: row.customer_overdue_currency1,
                amount: Number(row.customer_overdue_amount1 ?? 0),
            },
            {
                currency: row.customer_overdue_currency2,
                amount: Number(row.customer_overdue_amount2 ?? 0),
            },
            {
                currency: row.customer_due_currency1,
                amount: Number(row.customer_due_amount1 ?? 0),
            },
            {
                currency: row.customer_due_currency2,
                amount: Number(row.customer_due_amount2 ?? 0),
            },
        ];
        for (const candidate of candidates) {
            if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) {
                continue;
            }
            addPair(accountCurrency, normalizeCurrency(candidate.currency));
        }
    }

    return Array.from(uniquePairs).map((pair) => {
        const [baseCurrency, otherCurrency] = pair.split("->") as [
            string,
            string,
        ];
        return { baseCurrency, otherCurrency };
    });
}

async function fetchRatesForBase(
    baseCurrency: string,
    targetCurrencies: string[]
): Promise<Record<string, number>> {
    const targets = targetCurrencies.join(",");
    const response = await fetch(
        `https://api.frankfurter.app/latest?from=${encodeURIComponent(baseCurrency)}&to=${encodeURIComponent(targets)}`
    );
    if (!response.ok) {
        throw new Error(
            `Failed to fetch FX rates for ${baseCurrency}: HTTP ${response.status}`
        );
    }

    const payload = (await response.json()) as FrankfurterResponse;
    return payload.rates || {};
}

export async function fetchAndStoreCurrencyRates(
    prisma: import("@prisma/client").PrismaClient,
): Promise<{
    pairsRequested: number;
    ratesStored: number;
    rateDate: Date;
}> {
    const pairs = await getDistinctCurrencyPairs(prisma);
    if (pairs.length === 0) {
        return {
            pairsRequested: 0,
            ratesStored: 0,
            rateDate: startOfTodayUtc(),
        };
    }

    const targetsByBase = new Map<string, Set<string>>();
    for (const pair of pairs) {
        if (!targetsByBase.has(pair.baseCurrency)) {
            targetsByBase.set(pair.baseCurrency, new Set<string>());
        }
        targetsByBase.get(pair.baseCurrency)!.add(pair.otherCurrency);
    }

    const rateDate = startOfTodayUtc();
    let ratesStored = 0;

    for (const [baseCurrency, targetSet] of Array.from(targetsByBase.entries())) {
        const targetCurrencies = Array.from(targetSet);
        const rates = await fetchRatesForBase(baseCurrency, targetCurrencies);

        for (const otherCurrency of targetCurrencies) {
            const currencyRatio = rates[otherCurrency];
            if (typeof currencyRatio !== "number" || !Number.isFinite(currencyRatio)) {
                continue;
            }

            await prisma.currencyRate.upsert({
                where: {
                    rate_date_base_currency_other_currency: {
                        rate_date: rateDate,
                        base_currency: baseCurrency,
                        other_currency: otherCurrency,
                    },
                },
                update: {
                    currency_ratio: currencyRatio,
                    modified_by: "system",
                },
                create: {
                    rate_date: rateDate,
                    base_currency: baseCurrency,
                    other_currency: otherCurrency,
                    currency_ratio: currencyRatio,
                    created_by: "system",
                    modified_by: "system",
                },
            });
            ratesStored += 1;
        }
    }

    return {
        pairsRequested: pairs.length,
        ratesStored,
        rateDate,
    };
}
