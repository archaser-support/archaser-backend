"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCustomerCapacityGapForKpi = resolveCustomerCapacityGapForKpi;
exports.computePolicyCapacityGapKpi = computePolicyCapacityGapKpi;
exports.sumTermsBreachOutstandingFromInvoices = sumTermsBreachOutstandingFromInvoices;
exports.computeCustomerKpiSnapshotFromInvoices = computeCustomerKpiSnapshotFromInvoices;
const customerDashboardKpisService_1 = require("./customerDashboardKpisService");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
const invoiceCapacityGapAmounts_1 = require("./invoiceCapacityGapAmounts");
const termBreachResolver_1 = require("./termBreachResolver");
/**
 * Customer-level capacity gap for KPI / at-risk (golden harness + policy sync).
 * Capacity is the sum of sticky per-invoice gaps on still-open invoices — it is
 * not capped at (AR − limit). Gaps clear only when those invoices are paid down.
 */
function resolveCustomerCapacityGapForKpi(args) {
    void args.totalAr;
    void args.approvedLimit;
    void args.retainedCapacityGap;
    const capacity = Math.max(0, args.sumInvoiceGaps);
    return { capacity, retainedCapacityGap: capacity };
}
/** Policy sync / dashboard: KPI capacity from invoice gap sum + retained state. */
function computePolicyCapacityGapKpi(args) {
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
function sumTermsBreachOutstandingFromInvoices(invoices, asOf, options) {
    return (0, termBreachResolver_1.sumFlagBasedTermsBreachOutstanding)(invoices, asOf, options);
}
/**
 * End-of-day customer KPI snapshot using production formulas
 * ({@link computeCustomerRiskExposure}, {@link computeCustomerHealthIndex}).
 */
function computeCustomerKpiSnapshotFromInvoices(input) {
    const openInvoices = input.openInvoices.filter((inv) => inv.outstanding > 0);
    const totalAr = openInvoices.reduce((sum, inv) => sum + Math.max(0, inv.outstanding), 0);
    const { gapBase: sumInvoiceGaps } = (0, invoiceCapacityGapAmounts_1.sumStoredInvoiceCapacityGapRows)(openInvoices.map((invoice) => ({
        capacity_gap_amount: invoice.capacityGapAmount,
        capacity_gap_amount_limit: invoice.capacityGapAmountLimit,
        limit_assessed_amount: invoice.limitAssessedAmount,
    })));
    const capacityResolution = resolveCustomerCapacityGapForKpi({
        totalAr,
        sumInvoiceGaps,
        approvedLimit: input.approvedLimit,
        retainedCapacityGap: input.retainedCapacityGap ?? 0,
    });
    const capacity = capacityResolution.capacity;
    const uncovered = input.uncoveredExposure === true;
    const termBreach = (0, termBreachResolver_1.resolveCustomerTermsBreachOutstanding)({
        uncovered,
        totalOpenAr: totalAr,
        invoices: openInvoices,
        asOf: input.asOf,
    });
    const termsBreachForAtRisk = (0, termBreachResolver_1.resolveCustomerTermsBreachOutstanding)({
        uncovered,
        totalOpenAr: totalAr,
        invoices: openInvoices,
        asOf: input.asOf,
        excludeCapacityGapInvoices: true,
    });
    const notInsured = uncovered
        ? totalAr
        : (0, invoiceInsuranceFields_1.computeCustomerRiskExposure)({
            totalAr,
            capacityGapAmount: capacity,
            termsBreachOutstanding: termsBreachForAtRisk,
        });
    const healthIndexPct = (0, customerDashboardKpisService_1.computeCustomerHealthIndex)(totalAr, notInsured);
    return {
        totalAr,
        termBreach,
        capacity,
        notInsured,
        healthIndex: healthIndexPct / 100,
        retainedCapacityGap: capacityResolution.retainedCapacityGap,
    };
}
