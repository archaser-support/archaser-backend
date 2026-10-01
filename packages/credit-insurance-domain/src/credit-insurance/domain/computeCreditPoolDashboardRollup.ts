/**
 * Pure assembly for parent Dashboard / Aggregated credit block: pool AR,
 * capacity gap (root-only when viewing the top root), and at-risk per member.
 */
import {
    computeCustomerRiskExposure,
    type CustomerAtRiskInvoiceInput,
} from "./invoiceInsuranceFields";

export type CreditPoolDashboardMemberAr = {
    id: number;
    total_due_amount: number | null;
    total_overdue_amount: number | null;
};

export type CreditPoolDashboardPolicyFields = {
    approved_limit: number | null;
    approved_limit_currency: string | null;
    capacity_gap_amount: number | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};

export type CreditPoolDashboardKpis = {
    root_customer_id: number;
    approved_limit: number | null;
    approved_limit_currency: string | null;
    effective_limit: number | null;
    capacity_gap_amount: number | null;
    at_risk_exposure: number;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};

export type CreditPoolDashboardRollup = {
    isViewingPoolRoot: boolean;
    /** Gap applied to pool at-risk / KPI cards (0 when viewing a mid-level shell). */
    capacityGapForRollup: number;
    poolTotalAr: number;
    poolAtRiskExposure: number;
    /** Per-member at-risk (children: terms-breach only; root: pool total when viewing root). */
    atRiskByCustomer: Map<number, number>;
    /** Per-member capacity gap for the members table. */
    capacityGapByCustomer: Map<number, number>;
    kpis: CreditPoolDashboardKpis;
};

function numOrNull(value: number | null | undefined): number | null {
    if (value == null) {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/**
 * Compute Dashboard credit-pool KPIs and per-member at-risk/gap for a local
 * (already BU-filtered) member set.
 */
export function computeCreditPoolDashboardRollup(args: {
    viewerCustomerId: number;
    rootCustomerId: number;
    members: readonly CreditPoolDashboardMemberAr[];
    rootPolicy: CreditPoolDashboardPolicyFields | null;
    effectiveLimit: number | null;
    atRiskInvoicesByCustomer: ReadonlyMap<
        number,
        readonly CustomerAtRiskInvoiceInput[]
    >;
}): CreditPoolDashboardRollup {
    const { viewerCustomerId, rootCustomerId, members, rootPolicy } = args;
    const isViewingPoolRoot = viewerCustomerId === rootCustomerId;

    const rootCapacityGap =
        rootPolicy?.capacity_gap_amount != null
            ? Math.max(0, Number(rootPolicy.capacity_gap_amount))
            : 0;
    const capacityGapForRollup = isViewingPoolRoot ? rootCapacityGap : 0;

    const atRiskByCustomer = new Map<number, number>();
    const capacityGapByCustomer = new Map<number, number>();
    let poolTotalAr = 0;
    const allPoolAtRiskInvoices: CustomerAtRiskInvoiceInput[] = [];

    for (const member of members) {
        const due = Number(member.total_due_amount ?? 0) || 0;
        const overdue = Number(member.total_overdue_amount ?? 0) || 0;
        const totalAr = Math.max(0, due + overdue);
        poolTotalAr += totalAr;
        const invoices = [
            ...(args.atRiskInvoicesByCustomer.get(member.id) ?? []),
        ];
        allPoolAtRiskInvoices.push(...invoices);

        capacityGapByCustomer.set(
            member.id,
            member.id === rootCustomerId ? capacityGapForRollup : 0
        );

        // Children / non-root: terms-breach-only at-risk (capacity gap leg = 0).
        if (member.id !== rootCustomerId) {
            atRiskByCustomer.set(
                member.id,
                computeCustomerRiskExposure({
                    totalAr,
                    invoices,
                    capacityGapAmount: 0,
                })
            );
        }
    }

    const poolAtRiskExposure = computeCustomerRiskExposure({
        totalAr: poolTotalAr,
        invoices: allPoolAtRiskInvoices,
        capacityGapAmount: capacityGapForRollup,
    });
    if (isViewingPoolRoot) {
        atRiskByCustomer.set(rootCustomerId, poolAtRiskExposure);
    }

    const kpis: CreditPoolDashboardKpis = {
        root_customer_id: rootCustomerId,
        approved_limit: numOrNull(rootPolicy?.approved_limit),
        approved_limit_currency: rootPolicy?.approved_limit_currency ?? null,
        effective_limit: args.effectiveLimit,
        capacity_gap_amount: isViewingPoolRoot
            ? numOrNull(rootPolicy?.capacity_gap_amount)
            : 0,
        at_risk_exposure: poolAtRiskExposure,
        uninsured_amount: isViewingPoolRoot
            ? numOrNull(rootPolicy?.uninsured_amount)
            : null,
        capacity_gap_amount1: isViewingPoolRoot
            ? numOrNull(rootPolicy?.capacity_gap_amount1)
            : null,
        capacity_gap_currency1: isViewingPoolRoot
            ? (rootPolicy?.capacity_gap_currency1 ?? null)
            : null,
        capacity_gap_amount2: isViewingPoolRoot
            ? numOrNull(rootPolicy?.capacity_gap_amount2)
            : null,
        capacity_gap_currency2: isViewingPoolRoot
            ? (rootPolicy?.capacity_gap_currency2 ?? null)
            : null,
        uninsured_amount1: isViewingPoolRoot
            ? numOrNull(rootPolicy?.uninsured_amount1)
            : null,
        uninsured_currency1: isViewingPoolRoot
            ? (rootPolicy?.uninsured_currency1 ?? null)
            : null,
        uninsured_amount2: isViewingPoolRoot
            ? numOrNull(rootPolicy?.uninsured_amount2)
            : null,
        uninsured_currency2: isViewingPoolRoot
            ? (rootPolicy?.uninsured_currency2 ?? null)
            : null,
    };

    return {
        isViewingPoolRoot,
        capacityGapForRollup,
        poolTotalAr,
        poolAtRiskExposure,
        atRiskByCustomer,
        capacityGapByCustomer,
        kpis,
    };
}
