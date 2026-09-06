/**
 * Read helpers for stored CustomerPolicy gap / uninsured fields.
 * Writers use {@link computePolicyGapAmounts} only.
 */

import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
} from "./policyExclusion";

export type PolicyGapReadable = {
    capacity_gap_amount?: number | null;
    uninsured_amount?: number | null;
    capacity_gap_amount1?: number | null;
    capacity_gap_currency1?: string | null;
    capacity_gap_amount2?: number | null;
    capacity_gap_currency2?: string | null;
    uninsured_amount1?: number | null;
    uninsured_currency1?: string | null;
    uninsured_amount2?: number | null;
    uninsured_currency2?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean | null;
    insurance_policy_id?: number | null;
    policy_exclusion_reason?: string | null;
    approved_limit?: unknown;
};

/** Capacity gap is zeroed at read time when DCL is outdated or customer is uncovered. */
export function isPolicyCapacityGapSuppressed(c: PolicyGapReadable): boolean {
    if (c.outdated_dcl === true) {
        return true;
    }
    const hasLinkedPolicy =
        c.insurance_policy_id !== undefined
            ? hasActiveLinkedPolicy(c.insurance_policy_id)
            : true;
    const exclusionReason =
        c.policy_exclusion_reason ??
        (c.excluded_from_policy === true ? "excluded" : null);
    return isUncoveredExposureCustomer({ hasLinkedPolicy, exclusionReason });
}

/** Stored KPI capacity gap on CustomerPolicy (rollup via {@link computePolicyCapacityGapKpi}). */
export function storedCapacityGapAmount(c: PolicyGapReadable): number {
    if (isPolicyCapacityGapSuppressed(c)) {
        return 0;
    }
    if (c.approved_limit == null || c.approved_limit === undefined) {
        return 0;
    }
    if (c.capacity_gap_amount == null) {
        return 0;
    }
    return Math.max(0, Number(c.capacity_gap_amount));
}

/** @deprecated Use {@link storedCapacityGapAmount}. Kept for gradual call-site migration. */
export function readCapacityGapForDisplay(c: PolicyGapReadable): number {
    return storedCapacityGapAmount(c);
}

export type InvoiceCapacityGapRollup = {
    total: number | null;
    hasMissingSnapshots: boolean;
};

/**
 * At-risk / health-index capacity gap: invoice snapshots are authoritative when
 * every open invoice has `limit_assessed_amount` (unchanged on limit/top-up
 * increases). Stored CustomerPolicy gap is fallback only when snapshots are missing.
 */
export function resolveCapacityGapForAtRisk(
    storedRow: PolicyGapReadable,
    _openAr: number,
    invoiceGap?: InvoiceCapacityGapRollup | null
): number {
    if (isPolicyCapacityGapSuppressed(storedRow)) {
        return 0;
    }
    if (
        invoiceGap &&
        !invoiceGap.hasMissingSnapshots &&
        invoiceGap.total != null
    ) {
        return Math.max(0, Number(invoiceGap.total));
    }
    return storedCapacityGapAmount(storedRow);
}

/** Display uninsured: full open AR when excluded; otherwise stored value floored at 0. */
export function readUninsuredAmountForDisplay(
    c: PolicyGapReadable,
    openAr?: number | null
): number | null {
    if (c.excluded_from_policy === true) {
        if (openAr == null) {
            return null;
        }
        return Math.max(0, Number(openAr));
    }
    if (c.approved_limit == null || c.approved_limit === undefined) {
        return null;
    }
    if (c.uninsured_amount == null) {
        return 0;
    }
    return Math.max(0, Number(c.uninsured_amount));
}

/** Secondary header line from policy bucket when currency matches. */
export function storedCapacityGapInCurrency(
    c: PolicyGapReadable,
    currency: string
): number | null {
    const target = currency.trim().toUpperCase();
    if (!target) {
        return null;
    }
    const acct = c.capacity_gap_currency1?.trim().toUpperCase();
    if (acct === target && c.capacity_gap_amount1 != null) {
        return Math.max(0, Number(c.capacity_gap_amount1));
    }
    const acct2 = c.capacity_gap_currency2?.trim().toUpperCase();
    if (acct2 === target && c.capacity_gap_amount2 != null) {
        return Math.max(0, Number(c.capacity_gap_amount2));
    }
    return null;
}

export type PolicyRowForStoredGapSecondary = PolicyGapReadable & {
    insurance_policy_id?: number | null;
    is_active?: boolean;
};

/** Sum stored limit-currency gap across rows (one active row per insurance policy). */
export function sumStoredCapacityGapInCurrency(
    rows: PolicyGapReadable[],
    currency: string
): number | null {
    const target = currency.trim().toUpperCase();
    if (!target) {
        return null;
    }
    let total = 0;
    let found = false;
    for (const row of rows) {
        const part = storedCapacityGapInCurrency(row, target);
        if (part != null) {
            total += part;
            found = true;
        }
    }
    return found ? total : null;
}

/**
 * Capacity gap secondary line from synced invoice limit-currency totals
 * ({@link CustomerPolicy.capacity_gap_amount1}), not live FX or AR bucket ratio.
 */
export function resolveStoredCapacityGapSecondary(
    rows: PolicyRowForStoredGapSecondary[],
    currency: string,
    options?: { policyId?: number }
): number | null {
    let scoped: PolicyGapReadable[];
    if (options?.policyId != null) {
        const row = rows.find(
            (r) => r.insurance_policy_id === options.policyId
        );
        scoped = row ? [row] : [];
    } else {
        const byPolicyId = new Map<number, PolicyRowForStoredGapSecondary>();
        for (const row of rows) {
            const pid = row.insurance_policy_id;
            if (pid == null) {
                continue;
            }
            const existing = byPolicyId.get(pid);
            if (!existing || (row.is_active && !existing.is_active)) {
                byPolicyId.set(pid, row);
            }
        }
        scoped = Array.from(byPolicyId.values());
    }
    return sumStoredCapacityGapInCurrency(scoped, currency);
}
