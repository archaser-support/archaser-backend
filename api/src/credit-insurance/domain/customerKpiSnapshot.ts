import { computeCustomerHealthIndex } from "./customerDashboardKpisService";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";
import { sumStoredInvoiceCapacityGapRows } from "./invoiceCapacityGapAmounts";
import {
    resolveCustomerTermsBreachOutstanding,
    sumFlagBasedTermsBreachOutstanding,
    type TermBreachInvoiceRow,
} from "./termBreachResolver";

/** Open invoice row for in-memory / golden KPI snapshot (mirrors persisted breach flags). */
export type CustomerKpiInvoiceRow = {
    outstanding: number;
    limitAssessedAmount: number | null;
    capacityGapAmount: number;
    capacityGapAmountLimit: number;
    inCapacityGap: boolean;
    targetReportingDate: Date | null;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl?: boolean;
    ctvInvoiceAfterPolicyEnd?: boolean;
};

export type CustomerKpiSnapshotInput = {
    openInvoices: CustomerKpiInvoiceRow[];
    approvedLimit: number;
    asOf: Date;
    retainedCapacityGap?: number;
    /** When true, terms breach and at-risk use full open AR (uncovered exposure). */
    uncoveredExposure?: boolean;
};

export type CustomerKpiSnapshotResult = {
    totalAr: number;
    termBreach: number;
    capacity: number;
    notInsured: number;
    /** 0–1 unit scale (health index % ÷ 100). */
    healthIndex: number;
    retainedCapacityGap: number;
};

/**
 * Customer-level capacity gap for KPI / at-risk (golden harness + policy sync).
 * Rolls up sticky per-invoice gaps with retained snapshot when AR drops below limit.
 */
export function resolveCustomerCapacityGapForKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap: number;
}): { capacity: number; retainedCapacityGap: number } {
    const sumInvoiceGaps = Math.max(0, args.sumInvoiceGaps);
    if (sumInvoiceGaps <= 0) {
        return { capacity: 0, retainedCapacityGap: 0 };
    }

    const excessOverLimit = Math.max(0, args.totalAr - args.approvedLimit);
    if (excessOverLimit > 0) {
        const capacity = Math.min(sumInvoiceGaps, excessOverLimit);
        return { capacity, retainedCapacityGap: capacity };
    }

    if (
        args.retainedCapacityGap > 0 &&
        sumInvoiceGaps < args.retainedCapacityGap * 0.2
    ) {
        return { capacity: 0, retainedCapacityGap: 0 };
    }

    if (args.retainedCapacityGap > 0) {
        return {
            capacity: Math.min(sumInvoiceGaps, args.retainedCapacityGap),
            retainedCapacityGap: args.retainedCapacityGap,
        };
    }

    return { capacity: 0, retainedCapacityGap: 0 };
}

/** Policy sync / dashboard: KPI capacity from invoice gap sum + retained state. */
export function computePolicyCapacityGapKpi(args: {
    totalAr: number;
    sumInvoiceGaps: number;
    approvedLimit: number;
    retainedCapacityGap?: number | null;
}): { capacityGapAmount: number; retainedCapacityGap: number } {
    const result = resolveCustomerCapacityGapForKpi({
        totalAr: args.totalAr,
        sumInvoiceGaps: args.sumInvoiceGaps,
        approvedLimit: args.approvedLimit,
        retainedCapacityGap: args.retainedCapacityGap ?? 0,
    });
    return {
        capacityGapAmount: result.capacity,
        retainedCapacityGap: result.retainedCapacityGap,
    };
}

/** Same breach-outstanding rules as {@link getCustomerTermsBreachOutstandingSum}. */
export function sumTermsBreachOutstandingFromInvoices(
    invoices: CustomerKpiInvoiceRow[],
    asOf: Date,
    options?: { excludeCapacityGapInvoices?: boolean }
): number {
    return sumFlagBasedTermsBreachOutstanding(
        invoices as TermBreachInvoiceRow[],
        asOf,
        options
    );
}

/**
 * End-of-day customer KPI snapshot using production formulas
 * ({@link computeCustomerRiskExposure}, {@link computeCustomerHealthIndex}).
 */
export function computeCustomerKpiSnapshotFromInvoices(
    input: CustomerKpiSnapshotInput
): CustomerKpiSnapshotResult {
    const openInvoices = input.openInvoices.filter((inv) => inv.outstanding > 0);
    const totalAr = openInvoices.reduce(
        (sum, inv) => sum + Math.max(0, inv.outstanding),
        0
    );

    const { gapBase: sumInvoiceGaps } = sumStoredInvoiceCapacityGapRows(
        openInvoices.map((invoice) => ({
            capacity_gap_amount: invoice.capacityGapAmount,
            capacity_gap_amount_limit: invoice.capacityGapAmountLimit,
            limit_assessed_amount: invoice.limitAssessedAmount,
        }))
    );

    const capacityResolution = resolveCustomerCapacityGapForKpi({
        totalAr,
        sumInvoiceGaps,
        approvedLimit: input.approvedLimit,
        retainedCapacityGap: input.retainedCapacityGap ?? 0,
    });
    const capacity = capacityResolution.capacity;

    const uncovered = input.uncoveredExposure === true;
    const termBreach = resolveCustomerTermsBreachOutstanding({
        uncovered,
        totalOpenAr: totalAr,
        invoices: openInvoices,
        asOf: input.asOf,
    });
    const termsBreachForAtRisk = resolveCustomerTermsBreachOutstanding({
        uncovered,
        totalOpenAr: totalAr,
        invoices: openInvoices,
        asOf: input.asOf,
        excludeCapacityGapInvoices: true,
    });

    const notInsured = uncovered
        ? totalAr
        : computeCustomerRiskExposure({
              totalAr,
              capacityGapAmount: capacity,
              termsBreachOutstanding: termsBreachForAtRisk,
          });

    const healthIndexPct = computeCustomerHealthIndex(totalAr, notInsured);

    return {
        totalAr,
        termBreach,
        capacity,
        notInsured,
        healthIndex: healthIndexPct / 100,
        retainedCapacityGap: capacityResolution.retainedCapacityGap,
    };
}
