export type PolicyKindForAnnualCreditAssessmentFee = "Primary" | "TopUp";

export type AnnualCreditAssessmentFeeValidationErrorCode =
    | "invalid_number"
    | "negative";

function isBlankValue(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === "";
}

/**
 * Server-side normalization for the master-policy Annual Credit Assessment Fee
 * (account-currency money amount).
 *
 * - TopUp policies always normalize the fee to null (policy-type boundary).
 * - Primary policies accept null/blank (no fee configured) and finite
 *   non-negative amounts.
 * - Anything else throws, keeping client and server validation in parity.
 */
export function parseAnnualCreditAssessmentFee(
    value: unknown,
    policyKind: PolicyKindForAnnualCreditAssessmentFee
): number | null {
    if (policyKind === "TopUp") {
        return null;
    }
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
        throw new Error("annual_credit_assessment_fee must be a valid number");
    }
    if (parsed < 0) {
        throw new Error(
            "annual_credit_assessment_fee must be greater than or equal to 0"
        );
    }
    return parsed;
}

export function validateAnnualCreditAssessmentFeeFormField(
    raw: string,
    policyKind: PolicyKindForAnnualCreditAssessmentFee
): {
    value: number | null;
    error?: AnnualCreditAssessmentFeeValidationErrorCode;
} {
    if (policyKind === "TopUp") {
        return { value: null };
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return { value: null };
    }
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) {
        return { value: null, error: "invalid_number" };
    }
    if (parsed < 0) {
        return { value: null, error: "negative" };
    }
    return { value: parsed };
}

/**
 * Whole-year billing multiplier for Annual Credit Assessment Fee.
 * Any positive partial year still bills one full year; multi-year ranges
 * scale by ceil whole years. Non-positive / non-finite days → 1.
 */
export function computeAssessmentYearMultiplier(inclusiveDays: number): number {
    if (!Number.isFinite(inclusiveDays) || inclusiveDays <= 0) {
        return 1;
    }
    return Math.max(1, Math.ceil(inclusiveDays / 365));
}

/**
 * Assessment money for one policy: current fee × named-in-range count × years.
 * Null / non-finite fee contributes 0.
 */
export function computeAnnualCreditAssessmentCost(input: {
    fee: number | null | undefined;
    namedCustomerCount: number;
    yearMultiplier: number;
}): number {
    const fee =
        input.fee == null || !Number.isFinite(input.fee) ? 0 : input.fee;
    const namedCustomerCount = Number.isFinite(input.namedCustomerCount)
        ? Math.max(0, input.namedCustomerCount)
        : 0;
    const yearMultiplier = Number.isFinite(input.yearMultiplier)
        ? Math.max(1, input.yearMultiplier)
        : 1;
    return fee * namedCustomerCount * yearMultiplier;
}

/**
 * Multi-policy Σ of assessment cost using one shared year multiplier.
 * Named count is the sum of per-policy distinct named-in-range counts.
 */
export function sumAnnualCreditAssessmentCost(
    policies: Array<{
        fee: number | null | undefined;
        namedCustomerCount: number;
    }>,
    yearMultiplier: number
): {
    annualCreditAssessmentCost: number;
    namedCustomerCountInRange: number;
    yearMultiplier: number;
} {
    const resolvedYears =
        Number.isFinite(yearMultiplier) && yearMultiplier >= 1
            ? Math.floor(yearMultiplier)
            : 1;

    let annualCreditAssessmentCost = 0;
    let namedCustomerCountInRange = 0;
    for (const policy of policies) {
        const count = Number.isFinite(policy.namedCustomerCount)
            ? Math.max(0, policy.namedCustomerCount)
            : 0;
        namedCustomerCountInRange += count;
        annualCreditAssessmentCost += computeAnnualCreditAssessmentCost({
            fee: policy.fee,
            namedCustomerCount: count,
            yearMultiplier: resolvedYears,
        });
    }

    return {
        annualCreditAssessmentCost,
        namedCustomerCountInRange,
        yearMultiplier: resolvedYears,
    };
}

/**
 * Utilization idle-named assessment: Σ idle counts and fee × idle × years.
 * Idle share is vs the same named-anytime-in-range denominator as Costs.
 * Null fee → $0 cost; counts/ratio still compute.
 */
export function sumIdleNamedAnnualCreditAssessment(
    policies: Array<{
        fee: number | null | undefined;
        namedCustomerCount: number;
        idleNamedCustomerCount: number;
    }>,
    yearMultiplier: number
): {
    idleNamedCustomerCount: number;
    namedCustomerCountInRange: number;
    idleNamedCustomerPct: number;
    idleNamedAnnualCreditAssessmentCost: number;
    yearMultiplier: number;
} {
    const resolvedYears =
        Number.isFinite(yearMultiplier) && yearMultiplier >= 1
            ? Math.floor(yearMultiplier)
            : 1;

    let idleNamedCustomerCount = 0;
    let namedCustomerCountInRange = 0;
    let idleNamedAnnualCreditAssessmentCost = 0;

    for (const policy of policies) {
        const named = Number.isFinite(policy.namedCustomerCount)
            ? Math.max(0, policy.namedCustomerCount)
            : 0;
        const idleRaw = Number.isFinite(policy.idleNamedCustomerCount)
            ? Math.max(0, policy.idleNamedCustomerCount)
            : 0;
        const idle = Math.min(idleRaw, named);
        namedCustomerCountInRange += named;
        idleNamedCustomerCount += idle;
        idleNamedAnnualCreditAssessmentCost += computeAnnualCreditAssessmentCost(
            {
                fee: policy.fee,
                namedCustomerCount: idle,
                yearMultiplier: resolvedYears,
            }
        );
    }

    const idleNamedCustomerPct =
        namedCustomerCountInRange > 0
            ? (100 * idleNamedCustomerCount) / namedCustomerCountInRange
            : 0;

    return {
        idleNamedCustomerCount,
        namedCustomerCountInRange,
        idleNamedCustomerPct,
        idleNamedAnnualCreditAssessmentCost,
        yearMultiplier: resolvedYears,
    };
}
