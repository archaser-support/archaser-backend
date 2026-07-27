import { Prisma } from "@prisma/client";
export declare function isDclCustomerCreditScoreBelowPolicyMin(args: {
    limitType: string | null | undefined;
    creditScore: unknown;
    minCreditScore: unknown;
}): boolean;
export declare function startOfUtcCalendarDayFromDate(d: Date): Date;
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
export declare function isApprovedLimitExpirationDateInPast(args: {
    expirationDate: Date | null | undefined;
    today?: Date;
}): boolean;
export type DclApprovedLimitAutoAdjustArgs = {
    limitType: string | null | undefined;
    outdatedDcl: boolean;
    creditScore: unknown;
    minCreditScore: unknown;
    userProvidedApprovedLimit: boolean;
    existingApprovedLimit: unknown;
    patchedApprovedLimit: unknown | undefined;
    approvedLimitExpirationDate: Date | null | undefined;
    zeroLimitDate?: Date | null | undefined;
    policyMaxDcl: unknown | null | undefined;
    today?: Date;
};
export declare function resolveDclApprovedLimitAfterOutdatedRecompute(args: DclApprovedLimitAutoAdjustArgs): {
    approved_limit?: Prisma.Decimal;
};
