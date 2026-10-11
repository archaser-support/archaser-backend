import { Prisma } from "@prisma/client";

import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";
import {
    asOfTermsScopeKey,
    type AsOfPolicyTermsForBreach,
} from "./asOfOpenAr";

/** Minimal CustomerPolicy fields needed to pick the version effective on day D. */
export type CustomerPolicyVersionForAsOf = {
    id: number;
    customer_id: number;
    is_active: boolean;
    policy_change_start_date: Date;
    policy_change_end_date: Date | null;
    insurance_policy_id: number | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    mep_cutoff_day: number | null;
    mep_substitute_extra_days: number | null;
    reporting_cutoff_day: number | null;
    reporting_substitute_extra_days: number | null;
    payment_term_cutoff_day: number | null;
    payment_term_substitute_day: number | null;
    InsurancePolicy: { end_date: Date | null } | null;
};

function versionSortKey(cp: CustomerPolicyVersionForAsOf): [number, number] {
    return [toUtcDateOnly(cp.policy_change_start_date).getTime(), cp.id];
}

function isStrictlyLaterVersion(
    a: CustomerPolicyVersionForAsOf,
    b: CustomerPolicyVersionForAsOf
): boolean {
    const [aStart, aId] = versionSortKey(a);
    const [bStart, bId] = versionSortKey(b);
    return aStart > bStart || (aStart === bStart && aId > bId);
}

/**
 * Whether a CustomerPolicy version supplies terms/limits on as-of day D.
 *
 * - Version starts on/before D.
 * - Unassign/run-off and supersede: `policy_change_end_date` is the first day
 *   the version is no longer the live attachment (D &lt; end). New writers set
 *   end_date to the next version's start; legacy rows may still have null end
 *   and are closed by the next version's start (see successor check below).
 * - When D is before every recorded start, the earliest version is extended
 *   backward (prehistory before copy-on-write dating).
 */
export function isCustomerPolicyVersionEffectiveOnDate(
    cp: CustomerPolicyVersionForAsOf,
    asOfDate: Date,
    allVersionsForCustomer: readonly CustomerPolicyVersionForAsOf[]
): boolean {
    if (cp.insurance_policy_id == null) {
        return false;
    }
    const dayMs = toUtcDateOnly(asOfDate).getTime();
    const startMs = toUtcDateOnly(cp.policy_change_start_date).getTime();
    const endMs =
        cp.policy_change_end_date != null
            ? toUtcDateOnly(cp.policy_change_end_date).getTime()
            : null;

    const withPolicy = allVersionsForCustomer.filter(
        (row) => row.insurance_policy_id != null
    );
    if (withPolicy.length === 0) {
        return false;
    }

    const earliest = withPolicy.reduce((best, row) =>
        isStrictlyLaterVersion(best, row) ? row : best
    );
    const earliestStartMs = toUtcDateOnly(
        earliest.policy_change_start_date
    ).getTime();

    // Prehistory: no version has started yet → earliest row's terms apply.
    if (dayMs < earliestStartMs) {
        return cp.id === earliest.id;
    }

    if (startMs > dayMs) {
        return false;
    }
    if (endMs != null && dayMs >= endMs) {
        return false;
    }

    // Latest version that already started on/before D (and not past unassign).
    const covering = withPolicy.filter((row) => {
        const rowStart = toUtcDateOnly(row.policy_change_start_date).getTime();
        if (rowStart > dayMs) {
            return false;
        }
        if (row.policy_change_end_date != null) {
            const rowEnd = toUtcDateOnly(row.policy_change_end_date).getTime();
            if (dayMs >= rowEnd) {
                return false;
            }
        }
        return true;
    });
    if (covering.length === 0) {
        return false;
    }
    const latest = covering.reduce((best, row) =>
        isStrictlyLaterVersion(row, best) ? row : best
    );
    /**
     * Inactive + null end + no later successor = orphan history (removed without
     * dated unassign). Do not treat as live on D. Inactive + null end with a
     * later successor is a normal superseded version and stays valid until that
     * successor's start.
     */
    const hasLaterSuccessor = withPolicy.some((row) =>
        isStrictlyLaterVersion(row, latest)
    );
    if (
        !latest.is_active &&
        latest.policy_change_end_date == null &&
        !hasLaterSuccessor
    ) {
        return false;
    }
    return latest.id === cp.id;
}

/**
 * One CustomerPolicy version per customer for as-of day D (terms + CPT overlay).
 */
export function selectCustomerPoliciesEffectiveOnDate<
    T extends CustomerPolicyVersionForAsOf,
>(policies: readonly T[], asOfDate: Date): T[] {
    const byCustomer = new Map<number, T[]>();
    for (const cp of policies) {
        if (cp.insurance_policy_id == null) {
            continue;
        }
        const bucket = byCustomer.get(cp.customer_id) ?? [];
        bucket.push(cp);
        byCustomer.set(cp.customer_id, bucket);
    }
    const selected: T[] = [];
    for (const [, versions] of byCustomer) {
        const hit = versions.find((cp) =>
            isCustomerPolicyVersionEffectiveOnDate(cp, asOfDate, versions)
        );
        if (hit) {
            selected.push(hit);
        }
    }
    return selected;
}

/**
 * CPT writers on day D: version effective on D, plus dated-unassign run-off
 * rows (inactive with `policy_change_end_date` and D ≥ end) for customers with
 * no effective version on D — superseded versions also carry an end date and
 * must not double-count AR next to their successor. One run-off row per
 * customer + insurance policy (latest ended version); zero-length (voided)
 * versions never write run-off.
 */
export function selectCustomerPoliciesForTrendWriteOnDate<
    T extends CustomerPolicyVersionForAsOf,
>(policies: readonly T[], asOfDate: Date): T[] {
    const dayMs = toUtcDateOnly(asOfDate).getTime();
    const effective = selectCustomerPoliciesEffectiveOnDate(policies, asOfDate);
    const customersWithEffective = new Set(effective.map((cp) => cp.customer_id));
    const runOffByScope = new Map<string, T>();
    for (const cp of policies) {
        if (
            cp.insurance_policy_id == null ||
            cp.is_active ||
            cp.policy_change_end_date == null ||
            customersWithEffective.has(cp.customer_id)
        ) {
            continue;
        }
        const endMs = toUtcDateOnly(cp.policy_change_end_date).getTime();
        const startMs = toUtcDateOnly(cp.policy_change_start_date).getTime();
        if (dayMs < endMs || endMs <= startMs) {
            continue;
        }
        const key = `${cp.customer_id}:${cp.insurance_policy_id}`;
        const prior = runOffByScope.get(key);
        if (
            prior == null ||
            endMs > toUtcDateOnly(prior.policy_change_end_date!).getTime() ||
            (endMs === toUtcDateOnly(prior.policy_change_end_date!).getTime() &&
                isStrictlyLaterVersion(cp, prior))
        ) {
            runOffByScope.set(key, cp);
        }
    }
    return [...effective, ...runOffByScope.values()];
}

/**
 * SQL `ORDER BY` tail for `DISTINCT ON (t.customer_id, t.snapshot_date)` that
 * keeps one CPT row per customer per day, matching
 * {@link selectCustomerPoliciesEffectiveOnDate}: the effective version's row
 * wins over dated-unassign run-off rows; run-off is used only when no
 * effective row exists. Requires aliases `t` ("CustomerPolicyTrend") and `cp`
 * (`LEFT JOIN "CustomerPolicy" cp ON cp.id = t.customer_policy_id`).
 */
export const customerPolicyTrendEffectiveRowOrderSql = Prisma.sql`
    (cp.policy_change_end_date IS NOT NULL
        AND t.snapshot_date >= cp.policy_change_end_date) ASC NULLS LAST,
    (cp.policy_change_start_date > t.snapshot_date) ASC NULLS LAST,
    cp.policy_change_start_date DESC NULLS LAST,
    t.customer_policy_id DESC NULLS LAST
`;

function termsFromPolicy(
    cp: CustomerPolicyVersionForAsOf
): AsOfPolicyTermsForBreach {
    return {
        maxPaymentTerm: cp.max_payment_term,
        maxAllowedMep: cp.max_allowed_mep,
        reportingDays: cp.reporting_days,
        mepCutoffDay: cp.mep_cutoff_day,
        mepSubstituteExtraDays: cp.mep_substitute_extra_days,
        reportingCutoffDay: cp.reporting_cutoff_day,
        reportingSubstituteExtraDays: cp.reporting_substitute_extra_days,
        paymentTermCutoffDay: cp.payment_term_cutoff_day,
        paymentTermSubstituteDay: cp.payment_term_substitute_day,
        policyEndDate: cp.InsurancePolicy?.end_date ?? null,
    };
}

/**
 * Build the as-of terms map for calendar day D from versioned CustomerPolicy rows.
 * Prefer {@link buildAsOfTermsMapForDate} over mapping all loaded rows at once.
 */
export function buildAsOfTermsMapForDate(
    policies: readonly CustomerPolicyVersionForAsOf[],
    asOfDate: Date
): Map<string, AsOfPolicyTermsForBreach> {
    const termsByCustomerAndPolicy = new Map<string, AsOfPolicyTermsForBreach>();
    for (const cp of selectCustomerPoliciesEffectiveOnDate(policies, asOfDate)) {
        const terms = termsFromPolicy(cp);
        termsByCustomerAndPolicy.set(
            asOfTermsScopeKey(cp.customer_id, cp.insurance_policy_id),
            terms
        );
        const fallbackKey = asOfTermsScopeKey(cp.customer_id, null);
        if (!termsByCustomerAndPolicy.has(fallbackKey)) {
            termsByCustomerAndPolicy.set(fallbackKey, terms);
        }
    }
    return termsByCustomerAndPolicy;
}
