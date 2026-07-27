"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCustomerPolicyTrendSnapshotPayload = buildCustomerPolicyTrendSnapshotPayload;
const customerDashboardKpisService_1 = require("./customerDashboardKpisService");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
function resolveCompliantExposure(totalAr, atRiskExposure) {
    const ar = Math.max(0, totalAr);
    if (ar <= 0) {
        return 0;
    }
    const atRisk = Math.max(0, Math.min(ar, atRiskExposure));
    return Math.max(0, ar - atRisk);
}
function buildCustomerPolicyTrendSnapshotPayload(input) {
    const financialCurrency = input.accountCurrency?.trim().toUpperCase() || "USD";
    const totalReceivables = Math.max(0, input.totalReceivables);
    const capacityGapAmount = Math.max(0, input.capacityGapAmount);
    const termsBreachAmount = Math.max(0, input.termsBreachOutstanding);
    const atRiskExposure = (0, invoiceInsuranceFields_1.computeCustomerRiskExposure)({
        totalAr: totalReceivables,
        capacityGapAmount,
        termsBreachOutstanding: Math.max(0, input.termsBreachOutstandingForAtRisk),
    });
    const healthIndex = (0, customerDashboardKpisService_1.computeCustomerHealthIndex)(totalReceivables, atRiskExposure);
    const compliantExposure = resolveCompliantExposure(totalReceivables, atRiskExposure);
    const approvedLimit = input.approvedLimit;
    const usageMetrics = approvedLimit != null && approvedLimit > 0
        ? (0, customerDashboardKpisService_1.aggregatePolicyUsageFromRows)([
            {
                ar: Math.max(0, input.arInLimitCurrency),
                approvedLimit,
                topUpTotal: Math.max(0, input.topUpTotal ?? 0),
            },
        ])
        : {
            policyUsagePct: null,
            topUpUsagePct: null,
            effectiveUsagePct: null,
        };
    return {
        financialCurrency,
        totalReceivables,
        healthIndex,
        atRiskExposure,
        compliantExposure,
        capacityGapAmount,
        termsBreachAmount,
        policyUsagePct: usageMetrics.policyUsagePct,
        topUpUsagePct: usageMetrics.topUpUsagePct,
        effectiveUsagePct: usageMetrics.effectiveUsagePct,
    };
}
//# sourceMappingURL=customerPolicyTrendSnapshotPayload.js.map