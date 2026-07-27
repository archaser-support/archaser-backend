import { addMonths, differenceInCalendarDays, startOfDay } from "date-fns";
import { Prisma } from "@prisma/client";

type DecimalLike = { toString(): string };

function toNumberOrNull(value: unknown): number | null {
    if (value == null) {
        return null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    if (
        typeof value === "object" &&
        value !== null &&
        "toString" in value &&
        typeof (value as DecimalLike).toString === "function"
    ) {
        const n = Number((value as DecimalLike).toString());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/** DCL customer whose credit score is strictly below the policy minimum. */
export function isDclCustomerCreditScoreBelowPolicyMin(args: {
    limitType: string | null | undefined;
    creditScore: unknown;
    minCreditScore: unknown;
}): boolean {
    if (args.limitType !== "DCL") {
        return false;
    }
    const creditScore = toNumberOrNull(args.creditScore);
    const minCreditScore = toNumberOrNull(args.minCreditScore);
    return (
        creditScore !== null &&
        minCreditScore !== null &&
        creditScore < minCreditScore
    );
}

/**
 * UTC calendar day for the given instant (same basis as legacy customer `outdated_dcl` checks).
 */
export function startOfUtcCalendarDayFromDate(d: Date): Date {
    return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    );
}

/**
 * Whether the customer is in an "outdated DCL" state as of {@link evaluationDate}
 * (e.g. "today" for live customer rows, invoice issue date for creation-time snapshots).
 */
export function computeOutdatedDclAtEvaluation(args: {
    limitType: string | null | undefined;
    evaluationDate: Date;
    creditScore: unknown;
    minCreditScore: unknown;
    creditScoreInputDate: Date | null | undefined;
    scoreValidityPeriodMonths: number | null | undefined;
    activeCustomerSince: Date | null | undefined;
    dclCustomerSinceMonths: number | null | undefined;
}): boolean {
    if (args.limitType !== "DCL") {
        return false;
    }

    const evalStart = startOfUtcCalendarDayFromDate(args.evaluationDate);

    const isBelowMinScore = isDclCustomerCreditScoreBelowPolicyMin({
        limitType: args.limitType,
        creditScore: args.creditScore,
        minCreditScore: args.minCreditScore,
    });

    let isScoreValidityExpired = false;
    if (
        args.creditScoreInputDate &&
        args.scoreValidityPeriodMonths !== null &&
        args.scoreValidityPeriodMonths !== undefined
    ) {
        const validityEnd = addMonths(
            args.creditScoreInputDate,
            args.scoreValidityPeriodMonths
        );
        isScoreValidityExpired =
            differenceInCalendarDays(evalStart, validityEnd) > 0;
    }

    let isActiveCustomerSinceTooOld = false;
    if (
        args.activeCustomerSince &&
        args.dclCustomerSinceMonths !== null &&
        args.dclCustomerSinceMonths !== undefined
    ) {
        const oldestAllowedCustomerSince = addMonths(
            evalStart,
            -args.dclCustomerSinceMonths
        );
        isActiveCustomerSinceTooOld =
            differenceInCalendarDays(
                oldestAllowedCustomerSince,
                args.activeCustomerSince
            ) > 0;
    }

    return isBelowMinScore || isScoreValidityExpired || isActiveCustomerSinceTooOld;
}

export function computeCustomerOutdatedDcl(args: {
    limitType: string | null | undefined;
    creditScore: unknown;
    minCreditScore: unknown;
    creditScoreInputDate: Date | null | undefined;
    scoreValidityPeriodMonths: number | null | undefined;
    activeCustomerSince: Date | null | undefined;
    dclCustomerSinceMonths: number | null | undefined;
    today?: Date;
}): boolean {
    const today = args.today ?? new Date();
    return computeOutdatedDclAtEvaluation({
        limitType: args.limitType,
        evaluationDate: today,
        creditScore: args.creditScore,
        minCreditScore: args.minCreditScore,
        creditScoreInputDate: args.creditScoreInputDate,
        scoreValidityPeriodMonths: args.scoreValidityPeriodMonths,
        activeCustomerSince: args.activeCustomerSince,
        dclCustomerSinceMonths: args.dclCustomerSinceMonths,
    });
}

function approvedLimitIsZero(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    try {
        return new Prisma.Decimal(value as string | number).equals(0);
    } catch {
        return false;
    }
}

/**
 * True when expiration calendar date is strictly before "today" (limit was expired and zeroed by cron).
 */
export function isApprovedLimitExpirationDateInPast(args: {
    expirationDate: Date | null | undefined;
    today?: Date;
}): boolean {
    if (!args.expirationDate) {
        return false;
    }
    const today = args.today ?? new Date();
    return (
        differenceInCalendarDays(
            startOfDay(today),
            startOfDay(args.expirationDate)
        ) > 0
    );
}

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
export function resolveDclApprovedLimitAfterOutdatedRecompute(
    args: DclApprovedLimitAutoAdjustArgs
): { approved_limit?: Prisma.Decimal } {
    if (args.userProvidedApprovedLimit) {
        return {};
    }
    if (args.limitType !== "DCL" || args.outdatedDcl) {
        return {};
    }
    const effectiveApproved =
        args.patchedApprovedLimit !== undefined
            ? args.patchedApprovedLimit
            : args.existingApprovedLimit;
    if (effectiveApproved === null || effectiveApproved === undefined) {
        return {};
    }
    if (!approvedLimitIsZero(effectiveApproved)) {
        return {};
    }
    if (args.zeroLimitDate) {
        return {};
    }
    if (
        isApprovedLimitExpirationDateInPast({
            expirationDate: args.approvedLimitExpirationDate,
            today: args.today,
        })
    ) {
        return {};
    }
    if (args.policyMaxDcl == null) {
        return {};
    }
    try {
        const maxDcl = new Prisma.Decimal(args.policyMaxDcl as string | number);
        if (maxDcl.lte(0)) {
            return {};
        }
        return { approved_limit: maxDcl };
    } catch {
        return {};
    }
}
