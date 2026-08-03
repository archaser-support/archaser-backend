"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveInvoiceBucketRatioArPair = exports.resolveCustomerTotalArSecondaryFromInvoiceBuckets = exports.resolveCustomerCreditInsuranceSecondaryCurrency = exports.deriveSecondaryAmountFromInvoiceBucketRatio = void 0;
exports.convertAmountToCurrencyLatestRate = convertAmountToCurrencyLatestRate;
const domain_db_1 = require("../domain-db");
const invoiceBucketAmounts_1 = require("./shared/invoiceBucketAmounts");
Object.defineProperty(exports, "deriveSecondaryAmountFromInvoiceBucketRatio", { enumerable: true, get: function () { return invoiceBucketAmounts_1.deriveSecondaryAmountFromInvoiceBucketRatio; } });
Object.defineProperty(exports, "resolveCustomerCreditInsuranceSecondaryCurrency", { enumerable: true, get: function () { return invoiceBucketAmounts_1.resolveCustomerCreditInsuranceSecondaryCurrency; } });
Object.defineProperty(exports, "resolveCustomerTotalArSecondaryFromInvoiceBuckets", { enumerable: true, get: function () { return invoiceBucketAmounts_1.resolveCustomerTotalArSecondaryFromInvoiceBuckets; } });
Object.defineProperty(exports, "resolveInvoiceBucketRatioArPair", { enumerable: true, get: function () { return invoiceBucketAmounts_1.resolveInvoiceBucketRatioArPair; } });
/**
 * Live ECB-backed spot (same source as cron). Used when `CurrencyRate` has no row
 * for pairs like ILS→GBP (cron only stores limit→account policy pairs).
 */
async function fetchFrankfurterCrossRate(fromCurrency, toCurrency) {
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
        const payload = (await response.json());
        const r = payload.rates?.[to];
        if (typeof r !== "number" || !Number.isFinite(r) || r === 0) {
            return null;
        }
        return r;
    }
    catch {
        return null;
    }
}
/** Convert `amount` in `fromCurrency` to `toCurrency` using the latest stored rate (either direction). */
async function convertAmountToCurrencyLatestRate(fromCurrency, toCurrency, amount) {
    const from = fromCurrency.trim().toUpperCase();
    const to = toCurrency.trim().toUpperCase();
    if (!from || !to || from === to) {
        return amount;
    }
    if (!Number.isFinite(amount)) {
        return null;
    }
    const direct = await domain_db_1.prisma.currencyRate.findFirst({
        where: { base_currency: from, other_currency: to },
        orderBy: { rate_date: "desc" },
        select: { currency_ratio: true },
    });
    if (direct != null && typeof direct.currency_ratio === "number") {
        return amount * direct.currency_ratio;
    }
    const inverse = await domain_db_1.prisma.currencyRate.findFirst({
        where: { base_currency: to, other_currency: from },
        orderBy: { rate_date: "desc" },
        select: { currency_ratio: true },
    });
    if (inverse != null &&
        typeof inverse.currency_ratio === "number" &&
        inverse.currency_ratio !== 0) {
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
