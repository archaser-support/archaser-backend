"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inclusiveUtcCalendarDays = inclusiveUtcCalendarDays;
exports.computePolicyDailyCost = computePolicyDailyCost;
exports.computeTopUpDailyCostAggregate = computeTopUpDailyCostAggregate;
exports.computeTotalDailyCost = computeTotalDailyCost;
exports.computeCustomerDailyCostSnapshot = computeCustomerDailyCostSnapshot;
const resolveEffectiveApprovedLimit_1 = require("./resolveEffectiveApprovedLimit");
function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function inclusiveUtcCalendarDays(startDate, endDate) {
    const start = startOfUtcDay(startDate);
    const end = startOfUtcDay(endDate);
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((end.getTime() - start.getTime()) / msPerDay) + 1;
}
function normalizeCurrency(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed.toUpperCase() : null;
}
function computeTopUpDailyRate(premium, startDate, endDate) {
    const inclusiveDays = inclusiveUtcCalendarDays(startDate, endDate);
    if (inclusiveDays <= 0) {
        return 0;
    }
    return premium / inclusiveDays;
}
function computePolicyDailyCost(input) {
    const costCalculationMethod = input.costCalculationMethod ?? null;
    const costPercent = input.costPercent != null && Number.isFinite(input.costPercent)
        ? input.costPercent
        : null;
    if (input.excludedFromPolicy || input.outdatedDcl) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }
    if (costCalculationMethod == null || costPercent == null) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }
    const currency = normalizeCurrency(input.limitCurrency);
    if (!currency) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }
    let basisAmount = null;
    if (costCalculationMethod === "Limit") {
        basisAmount = input.approvedLimit;
    }
    else if (costCalculationMethod === "ActualSales") {
        basisAmount = Math.max(0, input.usageAmount);
    }
    if (basisAmount == null || basisAmount <= 0) {
        return {
            policyDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }
    const amount = (basisAmount * costPercent) / 100;
    return {
        policyDailyCost: { amount, currency },
        costCalculationMethod,
        costPercent,
    };
}
function computeTopUpDailyCostAggregate(activeTopUps, asOfDate) {
    const contributors = [];
    for (const topUp of activeTopUps) {
        if (!(0, resolveEffectiveApprovedLimit_1.isActiveTopUp)({
            start_date: topUp.startDate,
            end_date: topUp.endDate,
            cancelled_at: topUp.cancelledAt,
        }, asOfDate)) {
            continue;
        }
        if (topUp.premium == null || !Number.isFinite(topUp.premium)) {
            continue;
        }
        const currency = normalizeCurrency(topUp.premiumCurrency);
        if (!currency) {
            continue;
        }
        const dailyRate = computeTopUpDailyRate(topUp.premium, topUp.startDate, topUp.endDate);
        if (dailyRate <= 0) {
            continue;
        }
        contributors.push({ amount: dailyRate, currency });
    }
    if (contributors.length === 0) {
        return null;
    }
    const currencies = new Set(contributors.map((row) => row.currency));
    if (currencies.size > 1) {
        return null;
    }
    const currency = contributors[0].currency;
    const amount = contributors.reduce((sum, row) => sum + row.amount, 0);
    return { amount, currency };
}
function computeTotalDailyCost(policyPart, topUpPart) {
    if (policyPart == null && topUpPart == null) {
        return null;
    }
    if (policyPart != null && topUpPart == null) {
        return policyPart.amount;
    }
    if (policyPart == null && topUpPart != null) {
        return topUpPart.amount;
    }
    if (policyPart.currency === topUpPart.currency) {
        return policyPart.amount + topUpPart.amount;
    }
    return null;
}
function computeCustomerDailyCostSnapshot(args) {
    if (args.policyInput.excludedFromPolicy || args.policyInput.outdatedDcl) {
        const { costCalculationMethod, costPercent } = computePolicyDailyCost(args.policyInput);
        return {
            policyDailyCost: null,
            policyCostCurrency: null,
            topUpDailyCost: null,
            topUpCostCurrency: null,
            totalDailyCost: null,
            costCalculationMethod,
            costPercent,
        };
    }
    const policyResult = computePolicyDailyCost(args.policyInput);
    const topUpPart = computeTopUpDailyCostAggregate(args.activeTopUps, args.asOfDate);
    const totalDailyCost = computeTotalDailyCost(policyResult.policyDailyCost, topUpPart);
    return {
        policyDailyCost: policyResult.policyDailyCost?.amount ?? null,
        policyCostCurrency: policyResult.policyDailyCost?.currency ?? null,
        topUpDailyCost: topUpPart?.amount ?? null,
        topUpCostCurrency: topUpPart?.currency ?? null,
        totalDailyCost,
        costCalculationMethod: policyResult.costCalculationMethod,
        costPercent: policyResult.costPercent,
    };
}
//# sourceMappingURL=customerPolicyDailyCost.js.map