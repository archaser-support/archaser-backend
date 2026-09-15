/**
 * Policy concentration (KPI #9): top-1 / top-3 open-AR share on a shared policy
 * snapshot. Single-customer policies may still show 100% context but are excluded
 * from concentration *alerting*.
 */

/** Default top-1 share (%) that triggers a concentration alert when multi-customer. */
export const CONCENTRATION_ALERT_TOP1_PCT = 40;

export type PolicyConcentrationCustomerInput = {
    customerId: number;
    customerName: string;
    openAr: number;
};

export type PolicyConcentrationRankedCustomer = {
    customerId: number;
    customerName: string;
    openAr: number;
    /** Share of policy open AR (0–100). */
    sharePct: number;
};

export type PolicyConcentrationMetrics = {
    customerCount: number;
    /** Customers with openAr > 0 (denominator for shares). */
    customersWithOpenAr: number;
    totalOpenAr: number;
    /** Null when totalOpenAr ≤ 0. */
    top1SharePct: number | null;
    /** Null when totalOpenAr ≤ 0. */
    top3SharePct: number | null;
    top1CustomerId: number | null;
    top1CustomerName: string | null;
    /**
     * False when fewer than 2 customers with open AR — still may show 100%
     * context, but never fires concentrationAlert.
     */
    alertEligible: boolean;
    /** alertEligible && top1SharePct ≥ threshold. */
    concentrationAlert: boolean;
    ranking: PolicyConcentrationRankedCustomer[];
};

export type PolicyConcentrationThresholds = {
    alertTop1Pct?: number;
};

function emptyMetrics(): PolicyConcentrationMetrics {
    return {
        customerCount: 0,
        customersWithOpenAr: 0,
        totalOpenAr: 0,
        top1SharePct: null,
        top3SharePct: null,
        top1CustomerId: null,
        top1CustomerName: null,
        alertEligible: false,
        concentrationAlert: false,
        ranking: [],
    };
}

/**
 * Rank customers by open AR share on one policy snapshot day.
 * Negative AR is floored at 0 for share math.
 */
export function computePolicyConcentrationMetrics(
    customers: PolicyConcentrationCustomerInput[],
    thresholds?: PolicyConcentrationThresholds
): PolicyConcentrationMetrics {
    const alertTop1Pct =
        thresholds?.alertTop1Pct ?? CONCENTRATION_ALERT_TOP1_PCT;

    if (customers.length === 0) {
        return emptyMetrics();
    }

    const normalized = customers.map((c) => ({
        customerId: c.customerId,
        customerName: c.customerName,
        openAr: Number.isFinite(c.openAr) ? Math.max(0, c.openAr) : 0,
    }));

    const withOpenAr = normalized.filter((c) => c.openAr > 0);
    const totalOpenAr = withOpenAr.reduce((sum, c) => sum + c.openAr, 0);

    if (totalOpenAr <= 0) {
        return {
            ...emptyMetrics(),
            customerCount: normalized.length,
            customersWithOpenAr: 0,
        };
    }

    const ranking: PolicyConcentrationRankedCustomer[] = [...withOpenAr]
        .sort((a, b) => {
            const diff = b.openAr - a.openAr;
            if (diff !== 0) return diff;
            return a.customerId - b.customerId;
        })
        .map((c) => ({
            customerId: c.customerId,
            customerName: c.customerName,
            openAr: c.openAr,
            sharePct: (100 * c.openAr) / totalOpenAr,
        }));

    const top1 = ranking[0]!;
    const top1SharePct = top1.sharePct;
    const top3SharePct = ranking
        .slice(0, 3)
        .reduce((sum, c) => sum + c.sharePct, 0);

    const alertEligible = withOpenAr.length >= 2;
    const concentrationAlert =
        alertEligible && top1SharePct >= alertTop1Pct;

    return {
        customerCount: normalized.length,
        customersWithOpenAr: withOpenAr.length,
        totalOpenAr,
        top1SharePct,
        top3SharePct,
        top1CustomerId: top1.customerId,
        top1CustomerName: top1.customerName,
        alertEligible,
        concentrationAlert,
        ranking,
    };
}

/**
 * Customer context line: this customer's share of policy open AR.
 * Returns null when policy total ≤ 0 or customer AR is non-finite.
 */
export function computeCustomerShareOfPolicyOpenAr(
    customerOpenAr: number,
    policyTotalOpenAr: number
): number | null {
    if (
        !Number.isFinite(customerOpenAr) ||
        !Number.isFinite(policyTotalOpenAr) ||
        policyTotalOpenAr <= 0
    ) {
        return null;
    }
    return (100 * Math.max(0, customerOpenAr)) / policyTotalOpenAr;
}
