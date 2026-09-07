import { computeCustomerHealthIndex } from "./customerDashboardKpisService";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";
import {
    invoiceHasTermsBreachForKpi,
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
    /** Effective limit (approved + top-up) in the same currency as invoice outstanding. */
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
 * Card = max(0, open AR − effective limit). Per-invoice gaps are a live waterfall
 * cache and are not used to derive the customer figure.
 */
export function resolveCustomerCapacityGapForKpi(args: {
    totalAr: number;
    /**
     * Effective limit (approved + top-up). `approvedLimit` is accepted as an
     * alias for callers that still use that name.
     */
    effectiveLimit?: number;
    approvedLimit?: number;
    /** Unused — kept for call-site compatibility. */
    sumInvoiceGaps?: number;
    retainedCapacityGap?: number;
}): { capacity: number; retainedCapacityGap: number } {
    void args.sumInvoiceGaps;
    void args.retainedCapacityGap;
    const limit = Math.max(
        0,
        Number(
            args.effectiveLimit ??
                args.approvedLimit ??
                0
        )
    );
    const capacity = Math.max(0, args.totalAr - (Number.isFinite(limit) ? limit : 0));
    return { capacity, retainedCapacityGap: capacity };
}

/** Policy sync / dashboard: KPI capacity = AR − effective limit. */
export function computePolicyCapacityGapKpi(args: {
    totalAr: number;
    effectiveLimit?: number;
    approvedLimit?: number;
    sumInvoiceGaps?: number;
    retainedCapacityGap?: number | null;
}): { capacityGapAmount: number; retainedCapacityGap: number } {
    const result = resolveCustomerCapacityGapForKpi({
        totalAr: args.totalAr,
        effectiveLimit: args.effectiveLimit,
        approvedLimit: args.approvedLimit,
        sumInvoiceGaps: args.sumInvoiceGaps,
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

    const capacityResolution = resolveCustomerCapacityGapForKpi({
        totalAr,
        approvedLimit: input.approvedLimit,
    });
    const capacity = capacityResolution.capacity;

    const uncovered = input.uncoveredExposure === true;
    const termBreach = resolveCustomerTermsBreachOutstanding({
        uncovered,
        totalOpenAr: totalAr,
        invoices: openInvoices,
        asOf: input.asOf,
    });

    const notInsured = computeCustomerRiskExposure({
        uncovered,
        totalAr,
        invoices: openInvoices.map((invoice) => ({
            outstanding: Math.max(0, invoice.outstanding),
            capacityGapAmount: Math.max(0, invoice.capacityGapAmount),
            hasTermsBreach: invoiceHasTermsBreachForKpi(invoice, input.asOf),
        })),
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
