import {
    aggregatePolicyUsageFromRows,
    computeCustomerHealthIndex,
} from "./customerDashboardKpisService";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";

export type CustomerPolicyTrendSnapshotPayloadInput = {
    /** Account base currency for financial KPI amounts. */
    accountCurrency: string | null;
    /** Policy-scoped open AR in account base currency. */
    totalReceivables: number;
    capacityGapAmount: number;
    /** Full terms-breach outstanding (dashboard terms breach card). */
    termsBreachOutstanding: number;
    /** Terms-breach outstanding excluding capacity-gap invoices (at-risk driver). */
    termsBreachOutstandingForAtRisk: number;
    /** Open AR in policy limit currency (usage % formulas). */
    arInLimitCurrency: number;
    approvedLimit: number | null;
    topUpTotal: number | null;
};

export type CustomerPolicyTrendSnapshotFinancialPayload = {
    financialCurrency: string;
    totalReceivables: number;
    healthIndex: number;
    atRiskExposure: number;
    compliantExposure: number;
    capacityGapAmount: number;
    termsBreachAmount: number;
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
};

function resolveCompliantExposure(
    totalAr: number,
    atRiskExposure: number
): number {
    const ar = Math.max(0, totalAr);
    if (ar <= 0) {
        return 0;
    }
    const atRisk = Math.max(0, Math.min(ar, atRiskExposure));
    return Math.max(0, ar - atRisk);
}

/**
 * Pure mapper from live policy inputs → {@link CustomerPolicyTrend} financial KPI columns.
 * Formulas match {@link getCustomerDashboardKpis} for a single `insurance_policy_id` scope.
 */
export function buildCustomerPolicyTrendSnapshotPayload(
    input: CustomerPolicyTrendSnapshotPayloadInput
): CustomerPolicyTrendSnapshotFinancialPayload {
    const financialCurrency =
        input.accountCurrency?.trim().toUpperCase() || "USD";
    const totalReceivables = Math.max(0, input.totalReceivables);
    const capacityGapAmount = Math.max(0, input.capacityGapAmount);
    const termsBreachAmount = Math.max(0, input.termsBreachOutstanding);

    const atRiskExposure = computeCustomerRiskExposure({
        totalAr: totalReceivables,
        capacityGapAmount,
        termsBreachOutstanding: Math.max(
            0,
            input.termsBreachOutstandingForAtRisk
        ),
    });
    const healthIndex = computeCustomerHealthIndex(
        totalReceivables,
        atRiskExposure
    );
    const compliantExposure = resolveCompliantExposure(
        totalReceivables,
        atRiskExposure
    );

    const approvedLimit = input.approvedLimit;
    const usageMetrics =
        approvedLimit != null && approvedLimit > 0
            ? aggregatePolicyUsageFromRows([
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
