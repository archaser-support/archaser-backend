"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCustomerPolicyLimitUsageSegments = computeCustomerPolicyLimitUsageSegments;
exports.effectiveApprovedLimit = effectiveApprovedLimit;
exports.isApprovedLimitExpired = isApprovedLimitExpired;
exports.isEligiblePolicyLimitUsageRow = isEligiblePolicyLimitUsageRow;
exports.aggregatePortfolioPolicyLimitUsage = aggregatePortfolioPolicyLimitUsage;
const insurancePolicyLifecycle_1 = require("./shared/insurancePolicyLifecycle");
function emptyAccumulators() {
    return {
        openAr: 0,
        approvedLimit: 0,
        topUpTotal: 0,
        usedWithinLimit: 0,
        remaining: 0,
        topUpCoveredExcess: 0,
        uncoveredExposure: 0,
    };
}
/**
 * Per-customer bar segments: AR vs that customer's approved limit and top-up.
 */
function computeCustomerPolicyLimitUsageSegments(args) {
    const openAr = Math.max(0, Number(args.openArAccount) || 0);
    const approvedLimit = Math.max(0, Number(args.approvedLimitAccount) || 0);
    const topUpTotal = Math.max(0, Number(args.topUpTotalAccount) || 0);
    const usedWithinLimit = Math.min(openAr, approvedLimit);
    const remaining = Math.max(0, approvedLimit - openAr);
    const aboveBase = Math.max(0, openAr - approvedLimit);
    const topUpCoveredExcess = Math.min(aboveBase, topUpTotal);
    const uncoveredExposure = Math.max(0, aboveBase - topUpTotal);
    return {
        openAr,
        approvedLimit,
        topUpTotal,
        usedWithinLimit,
        remaining,
        topUpCoveredExcess,
        uncoveredExposure,
    };
}
/** Effective approved capacity: base approved limit plus active top-up cover. */
function effectiveApprovedLimit(approvedLimit, topUpTotal) {
    return Math.max(0, approvedLimit) + Math.max(0, topUpTotal);
}
function finalizeCategoryTotals(acc, options) {
    const limitForUsage = options.includeTopUpInUsage
        ? effectiveApprovedLimit(acc.approvedLimit, acc.topUpTotal)
        : Math.max(0, acc.approvedLimit);
    const usagePct = limitForUsage > 0
        ? (acc.usedWithinLimit / limitForUsage) * 100
        : 0;
    return {
        openAr: acc.openAr,
        approvedLimit: acc.approvedLimit,
        topUpTotal: acc.topUpTotal,
        usedWithinLimit: acc.usedWithinLimit,
        remaining: acc.remaining,
        topUpCoveredExcess: acc.topUpCoveredExcess,
        uncoveredExposure: acc.uncoveredExposure,
        usagePct,
    };
}
/** True when approved_limit_expiration_date is strictly before the as-of UTC day. */
function isApprovedLimitExpired(approvedLimitExpirationDate, asOfDate = new Date()) {
    if (approvedLimitExpirationDate == null) {
        return false;
    }
    const asOf = (0, insurancePolicyLifecycle_1.startOfTodayUtc)(asOfDate);
    const expiry = (0, insurancePolicyLifecycle_1.startOfTodayUtc)(approvedLimitExpirationDate);
    return expiry < asOf;
}
/**
 * Approved eligible customers only: active policy row, non-excluded,
 * non-outdated, non-expired, positive approved limit, Named or DCL.
 * Collection Active and Inactive both count.
 */
function isEligiblePolicyLimitUsageRow(row, asOfDate = new Date()) {
    if (!row.isActive) {
        return false;
    }
    if (row.excludedFromPolicy) {
        return false;
    }
    if (row.outdatedDcl) {
        return false;
    }
    if (!Number.isFinite(row.approvedLimitAccount) ||
        row.approvedLimitAccount <= 0) {
        return false;
    }
    if (isApprovedLimitExpired(row.approvedLimitExpirationDate, asOfDate)) {
        return false;
    }
    const limitType = row.limitType;
    return limitType === "Named" || limitType === "DCL";
}
function addCustomerSegmentsToCategory(category, segments) {
    category.openAr += segments.openAr;
    category.approvedLimit += segments.approvedLimit;
    category.topUpTotal += segments.topUpTotal;
    category.usedWithinLimit += segments.usedWithinLimit;
    category.remaining += segments.remaining;
    category.topUpCoveredExcess += segments.topUpCoveredExcess;
    category.uncoveredExposure += segments.uncoveredExposure;
}
/**
 * Aggregate approved eligible customer rows into combined, Named, and DCL/SDL
 * category totals. Bar segments (including top-up cover) are summed per customer;
 * they are not derived from portfolio (Σ AR − Σ limit) vs Σ top-up.
 */
function aggregatePortfolioPolicyLimitUsage(rows, asOfDate = new Date()) {
    const combined = emptyAccumulators();
    const named = emptyAccumulators();
    const dclSdl = emptyAccumulators();
    for (const row of rows) {
        if (!isEligiblePolicyLimitUsageRow(row, asOfDate)) {
            continue;
        }
        const segments = computeCustomerPolicyLimitUsageSegments({
            openArAccount: row.openArAccount,
            approvedLimitAccount: row.approvedLimitAccount,
            topUpTotalAccount: row.topUpTotalAccount,
        });
        addCustomerSegmentsToCategory(combined, segments);
        if (row.limitType === "Named") {
            addCustomerSegmentsToCategory(named, segments);
        }
        else if (row.limitType === "DCL") {
            addCustomerSegmentsToCategory(dclSdl, segments);
        }
    }
    return {
        combined: finalizeCategoryTotals(combined, {
            includeTopUpInUsage: true,
        }),
        named: finalizeCategoryTotals(named, { includeTopUpInUsage: false }),
        dclSdl: finalizeCategoryTotals(dclSdl, { includeTopUpInUsage: false }),
    };
}
