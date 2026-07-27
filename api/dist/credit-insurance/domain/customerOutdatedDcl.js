"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDclCustomerCreditScoreBelowPolicyMin = isDclCustomerCreditScoreBelowPolicyMin;
exports.startOfUtcCalendarDayFromDate = startOfUtcCalendarDayFromDate;
exports.computeOutdatedDclAtEvaluation = computeOutdatedDclAtEvaluation;
exports.computeCustomerOutdatedDcl = computeCustomerOutdatedDcl;
exports.isApprovedLimitExpirationDateInPast = isApprovedLimitExpirationDateInPast;
exports.resolveDclApprovedLimitAfterOutdatedRecompute = resolveDclApprovedLimitAfterOutdatedRecompute;
const date_fns_1 = require("date-fns");
const client_1 = require("@prisma/client");
function toNumberOrNull(value) {
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
    if (typeof value === "object" &&
        value !== null &&
        "toString" in value &&
        typeof value.toString === "function") {
        const n = Number(value.toString());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function isDclCustomerCreditScoreBelowPolicyMin(args) {
    if (args.limitType !== "DCL") {
        return false;
    }
    const creditScore = toNumberOrNull(args.creditScore);
    const minCreditScore = toNumberOrNull(args.minCreditScore);
    return (creditScore !== null &&
        minCreditScore !== null &&
        creditScore < minCreditScore);
}
function startOfUtcCalendarDayFromDate(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function computeOutdatedDclAtEvaluation(args) {
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
    if (args.creditScoreInputDate &&
        args.scoreValidityPeriodMonths !== null &&
        args.scoreValidityPeriodMonths !== undefined) {
        const validityEnd = (0, date_fns_1.addMonths)(args.creditScoreInputDate, args.scoreValidityPeriodMonths);
        isScoreValidityExpired =
            (0, date_fns_1.differenceInCalendarDays)(evalStart, validityEnd) > 0;
    }
    let isActiveCustomerSinceTooOld = false;
    if (args.activeCustomerSince &&
        args.dclCustomerSinceMonths !== null &&
        args.dclCustomerSinceMonths !== undefined) {
        const oldestAllowedCustomerSince = (0, date_fns_1.addMonths)(evalStart, -args.dclCustomerSinceMonths);
        isActiveCustomerSinceTooOld =
            (0, date_fns_1.differenceInCalendarDays)(oldestAllowedCustomerSince, args.activeCustomerSince) > 0;
    }
    return isBelowMinScore || isScoreValidityExpired || isActiveCustomerSinceTooOld;
}
function computeCustomerOutdatedDcl(args) {
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
function approvedLimitIsZero(value) {
    if (value === null || value === undefined) {
        return false;
    }
    try {
        return new client_1.Prisma.Decimal(value).equals(0);
    }
    catch {
        return false;
    }
}
function isApprovedLimitExpirationDateInPast(args) {
    if (!args.expirationDate) {
        return false;
    }
    const today = args.today ?? new Date();
    return ((0, date_fns_1.differenceInCalendarDays)((0, date_fns_1.startOfDay)(today), (0, date_fns_1.startOfDay)(args.expirationDate)) > 0);
}
function resolveDclApprovedLimitAfterOutdatedRecompute(args) {
    if (args.userProvidedApprovedLimit) {
        return {};
    }
    if (args.limitType !== "DCL" || args.outdatedDcl) {
        return {};
    }
    const effectiveApproved = args.patchedApprovedLimit !== undefined
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
    if (isApprovedLimitExpirationDateInPast({
        expirationDate: args.approvedLimitExpirationDate,
        today: args.today,
    })) {
        return {};
    }
    if (args.policyMaxDcl == null) {
        return {};
    }
    try {
        const maxDcl = new client_1.Prisma.Decimal(args.policyMaxDcl);
        if (maxDcl.lte(0)) {
            return {};
        }
        return { approved_limit: maxDcl };
    }
    catch {
        return {};
    }
}
//# sourceMappingURL=customerOutdatedDcl.js.map