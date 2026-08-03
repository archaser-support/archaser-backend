import { Prisma } from "@prisma/client";
/** DCL customer whose credit score is strictly below the policy minimum. */
export declare function isDclCustomerCreditScoreBelowPolicyMin(args: {
    limitType: string | null | undefined;
    creditScore: unknown;
    minCreditScore: unknown;
}): boolean;
/**
 * UTC calendar day for the given instant (same basis as legacy customer `outdated_dcl` checks).
 */
export declare function startOfUtcCalendarDayFromDate(d: Date): Date;
/**
 * Whether the customer is in an "outdated DCL" state as of {@link evaluationDate}
 * (e.g. "today" for live customer rows, invoice issue date for creation-time snapshots).
 */
export declare function computeOutdatedDclAtEvaluation(args: {
    limitType: string | null | undefined;
    evaluationDate: Date;
    creditScore: unknown;
    minCreditScore: unknown;
    creditScoreInputDate: Date | null | undefined;
    scoreValidityPeriodMonths: number | null | undefined;
    activeCustomerSince: Date | null | undefined;
    dclCustomerSinceMonths: number | null | undefined;
}): boolean;
export declare function computeCustomerOutdatedDcl(args: {
    limitType: string | null | undefined;
    creditScore: unknown;
    minCreditScore: unknown;
    creditScoreInputDate: Date | null | undefined;
    scoreValidityPeriodMonths: number | null | undefined;
    activeCustomerSince: Date | null | undefined;
    dclCustomerSinceMonths: number | null | undefined;
    today?: Date;
}): boolean;
/**
 * True when expiration calendar date is strictly before "today" (limit was expired and zeroed by cron).
 */
export declare function isApprovedLimitExpirationDateInPast(args: {
    expirationDate: Date | null | undefined;
    today?: Date;
}): boolean;
export type DclApprovedLimitAutoAdjustArgs = {
    limitType: string | null | undefined;
    outdatedDcl: boolean;
    creditScore: unknown;
    minCreditScore: unknown;
    /** When the client sent `approved_limit` in the request body (PATCH). */
    userProvidedApprovedLimit: boolean;
    existingApprovedLimit: unknown;
    patchedApprovedLimit: unknown | undefined;
    approvedLimitExpirationDate: Date | null | undefined;
    zeroLimitDate?: Date | null | undefined;
    policyMaxDcl: unknown | null | undefined;
    today?: Date;
};
/**
 * After recomputing DCL / credit rules: do not auto-zero approved limit when outdated/below-min;
 * only optionally restore policy `max_dcl` when the stored limit is 0, DCL is current, and limit was not
 * zeroed by an elapsed {@link Customer.approved_limit_expiration_date} or by an explicit
 * zero-limit workflow (`zero_limit_date` present).
 */
export declare function resolveDclApprovedLimitAfterOutdatedRecompute(args: DclApprovedLimitAutoAdjustArgs): {
    approved_limit?: Prisma.Decimal;
};
