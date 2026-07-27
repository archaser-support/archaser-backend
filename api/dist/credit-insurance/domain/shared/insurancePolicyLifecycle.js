"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPUP_PARENT_SYNC_ACTOR = exports.TOPUP_POLICY_PLACEHOLDER_END = exports.TOPUP_POLICY_PLACEHOLDER_START = void 0;
exports.startOfTodayUtc = startOfTodayUtc;
exports.toUtcDateOnly = toUtcDateOnly;
exports.utcDateKey = utcDateKey;
exports.isInsurancePolicyPastEndDate = isInsurancePolicyPastEndDate;
exports.isInsurancePolicyBeforeStartDate = isInsurancePolicyBeforeStartDate;
exports.isTodayWithinInsurancePolicyTerm = isTodayWithinInsurancePolicyTerm;
exports.validatePrimaryPolicyDateRange = validatePrimaryPolicyDateRange;
exports.isPrimaryPolicyEffectivelyActive = isPrimaryPolicyEffectivelyActive;
exports.isPrimaryPolicyAssignable = isPrimaryPolicyAssignable;
exports.primaryEffectivelyActivePrismaWhere = primaryEffectivelyActivePrismaWhere;
exports.isTopUpInsurancePolicyEffectivelyActive = isTopUpInsurancePolicyEffectivelyActive;
exports.topUpEffectivelyActivePrismaWhere = topUpEffectivelyActivePrismaWhere;
exports.effectivelyActivePrismaWhere = effectivelyActivePrismaWhere;
exports.canSetInsurancePolicyStatusActive = canSetInsurancePolicyStatusActive;
exports.resolveAutoActivateOnTermStart = resolveAutoActivateOnTermStart;
exports.resolveInsurancePolicyStatusOnUpdate = resolveInsurancePolicyStatusOnUpdate;
exports.resolveInsurancePolicyStatusOnCreate = resolveInsurancePolicyStatusOnCreate;
exports.shouldNotifyPolicyEligibleForActivation = shouldNotifyPolicyEligibleForActivation;
exports.isPrimaryPolicyEligibleForManualActivation = isPrimaryPolicyEligibleForManualActivation;
exports.TOPUP_POLICY_PLACEHOLDER_START = new Date("1970-01-01T00:00:00.000Z");
exports.TOPUP_POLICY_PLACEHOLDER_END = new Date("2099-12-31T00:00:00.000Z");
exports.TOPUP_PARENT_SYNC_ACTOR = "system:parent_policy_status_sync";
function startOfTodayUtc(from) {
    const now = from ?? new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function toUtcDateOnly(value) {
    if (typeof value === "string") {
        const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) {
            return new Date(`${m[1]}T00:00:00.000Z`);
        }
    }
    const d = value instanceof Date ? value : new Date(value);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function utcDateKey(value) {
    return toUtcDateOnly(value).toISOString().slice(0, 10);
}
function isInsurancePolicyPastEndDate(endDate, todayUtc = startOfTodayUtc()) {
    return toUtcDateOnly(endDate).getTime() < todayUtc.getTime();
}
function isInsurancePolicyBeforeStartDate(startDate, todayUtc = startOfTodayUtc()) {
    return toUtcDateOnly(startDate).getTime() > todayUtc.getTime();
}
function isTodayWithinInsurancePolicyTerm(startDate, endDate, todayUtc = startOfTodayUtc()) {
    const todayMs = todayUtc.getTime();
    const startMs = toUtcDateOnly(startDate).getTime();
    const endMs = toUtcDateOnly(endDate).getTime();
    return startMs <= todayMs && todayMs <= endMs;
}
function validatePrimaryPolicyDateRange(startDate, endDate) {
    if (toUtcDateOnly(startDate).getTime() > toUtcDateOnly(endDate).getTime()) {
        throw new Error("end_date must be on or after start_date");
    }
}
function isPrimaryPolicyEffectivelyActive(args) {
    const today = args.todayUtc ?? startOfTodayUtc();
    return (args.status === "Active" &&
        isTodayWithinInsurancePolicyTerm(args.startDate, args.endDate, today));
}
function isPrimaryPolicyAssignable(args) {
    return isPrimaryPolicyEffectivelyActive(args);
}
function primaryEffectivelyActivePrismaWhere(asOfDate = startOfTodayUtc()) {
    return {
        policy_kind: "Primary",
        status: "Active",
        start_date: { lte: asOfDate },
        end_date: { gte: asOfDate },
    };
}
function isTopUpInsurancePolicyEffectivelyActive(args) {
    if (args.topUpStatus !== "Active") {
        return false;
    }
    if (args.parentPolicyId == null) {
        return false;
    }
    if (args.parentStatus == null ||
        args.parentStartDate == null ||
        args.parentEndDate == null) {
        return false;
    }
    return isPrimaryPolicyAssignable({
        status: args.parentStatus,
        startDate: args.parentStartDate,
        endDate: args.parentEndDate,
        todayUtc: args.todayUtc,
    });
}
function topUpEffectivelyActivePrismaWhere(asOfDate = startOfTodayUtc()) {
    return {
        policy_kind: "TopUp",
        status: "Active",
        ParentInsurancePolicy: {
            is: {
                status: "Active",
                start_date: { lte: asOfDate },
                end_date: { gte: asOfDate },
            },
        },
    };
}
function effectivelyActivePrismaWhere(asOfDate = startOfTodayUtc()) {
    return {
        OR: [
            primaryEffectivelyActivePrismaWhere(asOfDate),
            topUpEffectivelyActivePrismaWhere(asOfDate),
        ],
    };
}
function canSetInsurancePolicyStatusActive(startDate, endDate, todayUtc = startOfTodayUtc()) {
    return isTodayWithinInsurancePolicyTerm(startDate, endDate, todayUtc);
}
function resolveAutoActivateOnTermStart(args) {
    if (args.policyKind === "TopUp") {
        return false;
    }
    if (args.status === "Active" || args.status === "Draft") {
        return false;
    }
    const today = args.todayUtc ?? startOfTodayUtc();
    if (isInsurancePolicyBeforeStartDate(args.startDate, today)) {
        if (args.bodyFlag !== undefined && args.bodyFlag !== null) {
            return Boolean(args.bodyFlag);
        }
        return true;
    }
    return false;
}
function resolveInsurancePolicyStatusOnUpdate(args) {
    if (args.policyKind === "TopUp") {
        return args.requestedStatus;
    }
    const today = args.todayUtc ?? startOfTodayUtc();
    if (args.requestedStatus === "Active" &&
        !canSetInsurancePolicyStatusActive(args.startDate, args.endDate, today)) {
        if (isInsurancePolicyBeforeStartDate(args.startDate, today)) {
            throw new Error("Cannot set status to Active before the policy start date");
        }
        throw new Error("Cannot set status to Active when end_date is before today");
    }
    return args.requestedStatus;
}
function resolveInsurancePolicyStatusOnCreate(args) {
    if (args.policyKind === "TopUp") {
        return args.requestedStatus;
    }
    const today = args.todayUtc ?? startOfTodayUtc();
    if (args.requestedStatus === "Active" &&
        !canSetInsurancePolicyStatusActive(args.startDate, args.endDate, today)) {
        if (isInsurancePolicyBeforeStartDate(args.startDate, today)) {
            throw new Error("Cannot set status to Active before the policy start date");
        }
        throw new Error("Cannot set status to Active when end_date is before today");
    }
    return args.requestedStatus;
}
function shouldNotifyPolicyEligibleForActivation(args) {
    if (args.policyKind !== "Primary" || args.status !== "Inactive") {
        return false;
    }
    if (!args.startDate || !args.nextEndDate) {
        return false;
    }
    const today = args.todayUtc ?? startOfTodayUtc();
    const endDateChanged = args.previousEndDate == null
        ? true
        : utcDateKey(args.previousEndDate) !== utcDateKey(args.nextEndDate);
    return (endDateChanged &&
        isTodayWithinInsurancePolicyTerm(args.startDate, args.nextEndDate, today));
}
function isPrimaryPolicyEligibleForManualActivation(args) {
    if (args.policyKind !== "Primary" || args.status !== "Inactive") {
        return false;
    }
    return canSetInsurancePolicyStatusActive(args.startDate, args.endDate, args.todayUtc);
}
//# sourceMappingURL=insurancePolicyLifecycle.js.map