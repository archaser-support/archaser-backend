/**
 * Anomalous negative daily-cost sign flag (Bucket 1 KPI #8).
 *
 * Surfaces CPT rows where policy_daily_cost or total_daily_cost is negative
 * beyond a configurable minimum magnitude so rounding noise (−$0.01) is
 * distinguishable from material credits/refunds. Does not change how period
 * cost totals are summed.
 */

/** Default: flag only when |negative amount| ≥ this (account currency units). */
export const NEGATIVE_COST_MIN_MAGNITUDE = 1;

export type NegativeCostThresholds = {
    minMagnitude?: number;
};

export type NegativeCostEntryInput = {
    customerId: number;
    customerName?: string;
    snapshotDate: string;
    policyDailyCost: number | null;
    totalDailyCost: number | null;
};

export type NegativeCostFlaggedEntry = {
    customerId: number;
    customerName: string;
    snapshotDate: string;
    /** Most negative qualifying cost amount (policy or total). */
    amount: number;
    policyDailyCost: number | null;
    totalDailyCost: number | null;
};

export type CustomerNegativeCostSummary = {
    customerId: number;
    customerName: string;
    negativeEntryCount: number;
    /** Sum of flagged negative amounts (always ≤ 0). */
    negativeEntrySum: number;
    worstNegativeAmount: number | null;
    worstNegativeDate: string | null;
};

export type PortfolioNegativeCostSummary = {
    negativeEntryCount: number;
    negativeEntrySum: number;
    customersAffected: number;
    minMagnitude: number;
};

function resolveMinMagnitude(thresholds?: NegativeCostThresholds): number {
    const m = thresholds?.minMagnitude;
    if (m == null || !Number.isFinite(m) || m < 0) {
        return NEGATIVE_COST_MIN_MAGNITUDE;
    }
    return m;
}

/**
 * Whether a CPT cost row is worth flagging, and which amount to surface.
 * Prefers the more negative of policy_daily_cost / total_daily_cost when both
 * qualify.
 */
export function resolveNegativeCostFlag(
    policyDailyCost: number | null | undefined,
    totalDailyCost: number | null | undefined,
    thresholds?: NegativeCostThresholds
): { flagged: boolean; amount: number | null } {
    const minMagnitude = resolveMinMagnitude(thresholds);
    const candidates: number[] = [];
    if (
        policyDailyCost != null &&
        Number.isFinite(policyDailyCost) &&
        policyDailyCost < 0 &&
        Math.abs(policyDailyCost) >= minMagnitude
    ) {
        candidates.push(policyDailyCost);
    }
    if (
        totalDailyCost != null &&
        Number.isFinite(totalDailyCost) &&
        totalDailyCost < 0 &&
        Math.abs(totalDailyCost) >= minMagnitude
    ) {
        candidates.push(totalDailyCost);
    }
    if (candidates.length === 0) {
        return { flagged: false, amount: null };
    }
    return { flagged: true, amount: Math.min(...candidates) };
}

export function collectNegativeCostEntries(
    rows: NegativeCostEntryInput[],
    thresholds?: NegativeCostThresholds
): NegativeCostFlaggedEntry[] {
    const out: NegativeCostFlaggedEntry[] = [];
    for (const row of rows) {
        const flag = resolveNegativeCostFlag(
            row.policyDailyCost,
            row.totalDailyCost,
            thresholds
        );
        if (!flag.flagged || flag.amount == null) {
            continue;
        }
        out.push({
            customerId: row.customerId,
            customerName: row.customerName?.trim() || String(row.customerId),
            snapshotDate: row.snapshotDate,
            amount: flag.amount,
            policyDailyCost: row.policyDailyCost,
            totalDailyCost: row.totalDailyCost,
        });
    }
    return out.sort((a, b) => {
        const byAmount = a.amount - b.amount;
        if (byAmount !== 0) {
            return byAmount;
        }
        const byDate = b.snapshotDate.localeCompare(a.snapshotDate);
        if (byDate !== 0) {
            return byDate;
        }
        return a.customerId - b.customerId;
    });
}

export function summarizeCustomerNegativeCosts(
    entries: NegativeCostFlaggedEntry[]
): CustomerNegativeCostSummary[] {
    const byCustomer = new Map<number, NegativeCostFlaggedEntry[]>();
    for (const entry of entries) {
        const list = byCustomer.get(entry.customerId) ?? [];
        list.push(entry);
        byCustomer.set(entry.customerId, list);
    }

    const summaries: CustomerNegativeCostSummary[] = [];
    for (const [customerId, list] of byCustomer) {
        let sum = 0;
        let worst: NegativeCostFlaggedEntry | null = null;
        for (const entry of list) {
            sum += entry.amount;
            if (worst == null || entry.amount < worst.amount) {
                worst = entry;
            }
        }
        summaries.push({
            customerId,
            customerName: list[0]?.customerName ?? String(customerId),
            negativeEntryCount: list.length,
            negativeEntrySum: sum,
            worstNegativeAmount: worst?.amount ?? null,
            worstNegativeDate: worst?.snapshotDate ?? null,
        });
    }

    return summaries.sort((a, b) => {
        const bySum = a.negativeEntrySum - b.negativeEntrySum;
        if (bySum !== 0) {
            return bySum;
        }
        return b.negativeEntryCount - a.negativeEntryCount;
    });
}

export function summarizePortfolioNegativeCosts(
    entries: NegativeCostFlaggedEntry[],
    thresholds?: NegativeCostThresholds
): PortfolioNegativeCostSummary {
    const customers = new Set(entries.map((e) => e.customerId));
    let sum = 0;
    for (const entry of entries) {
        sum += entry.amount;
    }
    return {
        negativeEntryCount: entries.length,
        negativeEntrySum: sum,
        customersAffected: customers.size,
        minMagnitude: resolveMinMagnitude(thresholds),
    };
}
