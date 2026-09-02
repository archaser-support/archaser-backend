"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAndStoreCurrencyRates = fetchAndStoreCurrencyRates;
function startOfTodayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function normalizeCurrency(code) {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}
async function getDistinctCurrencyPairs(prisma) {
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
    const uniquePairs = new Set();
    const addPair = (baseCurrency, otherCurrency) => {
        if (!baseCurrency || !otherCurrency || baseCurrency === otherCurrency) {
            return;
        }
        uniquePairs.add(`${baseCurrency}->${otherCurrency}`);
    };
    for (const row of activePolicyCurrencyRows) {
        const baseCurrency = normalizeCurrency(row.approved_limit_currency);
        const otherCurrency = normalizeCurrency(row.Customer.Account.currency);
        addPair(baseCurrency, otherCurrency);
    }
    for (const row of cardRows) {
        const accountCurrency = normalizeCurrency(row.Account.currency);
        const candidates = [
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
        const [baseCurrency, otherCurrency] = pair.split("->");
        return { baseCurrency, otherCurrency };
    });
}
async function fetchRatesForBase(baseCurrency, targetCurrencies) {
    const targets = targetCurrencies.join(",");
    const response = await fetch(`https://api.frankfurter.app/latest?from=${encodeURIComponent(baseCurrency)}&to=${encodeURIComponent(targets)}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch FX rates for ${baseCurrency}: HTTP ${response.status}`);
    }
    const payload = (await response.json());
    return payload.rates || {};
}
async function fetchAndStoreCurrencyRates(prisma) {
    const pairs = await getDistinctCurrencyPairs(prisma);
    if (pairs.length === 0) {
        return {
            pairsRequested: 0,
            ratesStored: 0,
            rateDate: startOfTodayUtc(),
        };
    }
    const targetsByBase = new Map();
    for (const pair of pairs) {
        if (!targetsByBase.has(pair.baseCurrency)) {
            targetsByBase.set(pair.baseCurrency, new Set());
        }
        targetsByBase.get(pair.baseCurrency).add(pair.otherCurrency);
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
