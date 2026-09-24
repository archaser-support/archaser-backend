import { roundMoney } from "./defaultRecognizedLoss";

export const CLAIM_STATUSES_WITH_EXCESS = ["Approved", "Paid"] as const;

export type ClaimStatusWithExcess =
    (typeof CLAIM_STATUSES_WITH_EXCESS)[number];

export function isClaimStatusWithExcess(
    status: string
): status is ClaimStatusWithExcess {
    return (CLAIM_STATUSES_WITH_EXCESS as readonly string[]).includes(status);
}

export type ExcessBuckets = {
    /** Null = bucket unset (skip). Zero Aggregate = none (skip Aggregate). */
    aggregateExcess: number | null;
    /** Null = bucket unset (skip). Zero SDL = no capacity this year. */
    sdlExcess: number | null;
};

export type AppliedExcess = {
    appliedSdl: number;
    appliedAggregate: number;
};

export type ExcessApplicationInput = {
    recognizedLoss: number;
    commercial: ExcessBuckets;
    /** Sum of applied SDL already taken by other Approved/Paid claims in the year. */
    alreadyAppliedSdl: number;
    /** Sum of applied Aggregate already taken by other Approved/Paid claims in the year. */
    alreadyAppliedAggregate: number;
};

/**
 * Deduct recognized loss from remaining SDL for the year first, then Aggregate.
 *
 * - SDL null → skip SDL bucket.
 * - Aggregate null or 0 → skip Aggregate bucket (0 means "none").
 * - Remaining after both buckets may leave some loss undeducted (no inventing capacity).
 */
export function applyClaimExcess(
    input: ExcessApplicationInput
): AppliedExcess {
    const loss = Math.max(0, roundMoney(input.recognizedLoss));
    let remaining = loss;

    let appliedSdl = 0;
    if (input.commercial.sdlExcess != null) {
        const sdlRemaining = Math.max(
            0,
            roundMoney(
                Number(input.commercial.sdlExcess) -
                    Number(input.alreadyAppliedSdl || 0)
            )
        );
        appliedSdl = roundMoney(Math.min(remaining, sdlRemaining));
        remaining = roundMoney(remaining - appliedSdl);
    }

    let appliedAggregate = 0;
    const aggConfigured = input.commercial.aggregateExcess;
    if (aggConfigured != null && Number(aggConfigured) > 0) {
        const aggRemaining = Math.max(
            0,
            roundMoney(
                Number(aggConfigured) -
                    Number(input.alreadyAppliedAggregate || 0)
            )
        );
        appliedAggregate = roundMoney(Math.min(remaining, aggRemaining));
    }

    return { appliedSdl, appliedAggregate };
}

/**
 * Remaining Aggregate/SDL for a policy year after Approved/Paid deductions.
 */
export function remainingExcessForPolicyYear(args: {
    commercial: ExcessBuckets;
    appliedSdlSum: number;
    appliedAggregateSum: number;
}): {
    remainingSdl: number | null;
    remainingAggregate: number | null;
} {
    const { commercial, appliedSdlSum, appliedAggregateSum } = args;

    const remainingSdl =
        commercial.sdlExcess == null
            ? null
            : roundMoney(
                  Math.max(0, Number(commercial.sdlExcess) - appliedSdlSum)
              );

    const remainingAggregate =
        commercial.aggregateExcess == null
            ? null
            : Number(commercial.aggregateExcess) === 0
              ? 0
              : roundMoney(
                    Math.max(
                        0,
                        Number(commercial.aggregateExcess) - appliedAggregateSum
                    )
                );

    return { remainingSdl, remainingAggregate };
}

/**
 * Whether a status transition should apply excess (first entry into Approved/Paid).
 */
export function shouldApplyExcessOnTransition(
    previousStatus: string,
    nextStatus: string,
    alreadyApplied: boolean
): boolean {
    if (alreadyApplied) {
        return false;
    }
    if (isClaimStatusWithExcess(previousStatus)) {
        return false;
    }
    return isClaimStatusWithExcess(nextStatus);
}

/**
 * Whether a status transition should reverse a prior excess deduction.
 */
export function shouldReverseExcessOnTransition(
    previousStatus: string,
    nextStatus: string,
    alreadyApplied: boolean
): boolean {
    if (!alreadyApplied) {
        return false;
    }
    if (!isClaimStatusWithExcess(previousStatus)) {
        return false;
    }
    return !isClaimStatusWithExcess(nextStatus);
}
