export type InsurancePolicyLifecycleStatus = "Active" | "Inactive" | "Draft";

/** DB placeholder dates for TopUp policies (no policy-level term). */
export const TOPUP_POLICY_PLACEHOLDER_START = new Date(
    "1970-01-01T00:00:00.000Z"
);
export const TOPUP_POLICY_PLACEHOLDER_END = new Date(
    "2099-12-31T00:00:00.000Z"
);

export const TOPUP_PARENT_SYNC_ACTOR = "system:parent_policy_status_sync";

/** UTC calendar date at 00:00:00.000Z for the given instant (or today). */
export function startOfTodayUtc(from?: Date): Date {
    const now = from ?? new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
}

/** Normalize API/DB dates to UTC midnight for DATE comparisons. */
export function toUtcDateOnly(value: Date | string): Date {
    if (typeof value === "string") {
        const m = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) {
            return new Date(`${m[1]}T00:00:00.000Z`);
        }
    }
    const d = value instanceof Date ? value : new Date(value);
    return new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    );
}

export function utcDateKey(value: Date | string): string {
    return toUtcDateOnly(value).toISOString().slice(0, 10);
}

/** True when policy end date is strictly before today UTC (expired; inactive from next day). */
export function isInsurancePolicyPastEndDate(
    endDate: Date | string,
    todayUtc: Date = startOfTodayUtc()
): boolean {
    return toUtcDateOnly(endDate).getTime() < todayUtc.getTime();
}

/** True when policy start date is strictly after today UTC. */
export function isInsurancePolicyBeforeStartDate(
    startDate: Date | string,
    todayUtc: Date = startOfTodayUtc()
): boolean {
    return toUtcDateOnly(startDate).getTime() > todayUtc.getTime();
}

/** Inclusive range: start_date <= today <= end_date. */
export function isTodayWithinInsurancePolicyTerm(
    startDate: Date | string,
    endDate: Date | string,
    todayUtc: Date = startOfTodayUtc()
): boolean {
    const todayMs = todayUtc.getTime();
    const startMs = toUtcDateOnly(startDate).getTime();
    const endMs = toUtcDateOnly(endDate).getTime();
    return startMs <= todayMs && todayMs <= endMs;
}

export function validatePrimaryPolicyDateRange(
    startDate: Date | string,
    endDate: Date | string
): void {
    if (
        toUtcDateOnly(startDate).getTime() > toUtcDateOnly(endDate).getTime()
    ) {
        throw new Error("end_date must be on or after start_date");
    }
}

/** Primary policy is in effect today (Active-eligible by dates). */
export function isPrimaryPolicyEffectivelyActive(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean {
    const today = args.todayUtc ?? startOfTodayUtc();
    return (
        args.status === "Active" &&
        isTodayWithinInsurancePolicyTerm(args.startDate, args.endDate, today)
    );
}

/** Primary policy can be assigned to a customer today. */
export function isPrimaryPolicyAssignable(args: {
    status: string | null | undefined;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean {
    return isPrimaryPolicyEffectivelyActive(args);
}

/** Prisma where: Primary policy with status Active and in term on asOfDate (UTC). */
export function primaryEffectivelyActivePrismaWhere(
    asOfDate: Date = startOfTodayUtc()
) {
    return {
        policy_kind: "Primary" as const,
        status: "Active" as const,
        start_date: { lte: asOfDate },
        end_date: { gte: asOfDate },
    };
}

/** TopUp insurance policy is effectively active today (Active + assignable parent). */
export function isTopUpInsurancePolicyEffectivelyActive(args: {
    topUpStatus: string | null | undefined;
    parentPolicyId?: number | null;
    parentStatus?: string | null;
    parentStartDate?: Date | string | null;
    parentEndDate?: Date | string | null;
    todayUtc?: Date;
}): boolean {
    if (args.topUpStatus !== "Active") {
        return false;
    }
    if (args.parentPolicyId == null) {
        return false;
    }
    if (
        args.parentStatus == null ||
        args.parentStartDate == null ||
        args.parentEndDate == null
    ) {
        return false;
    }
    return isPrimaryPolicyAssignable({
        status: args.parentStatus,
        startDate: args.parentStartDate,
        endDate: args.parentEndDate,
        todayUtc: args.todayUtc,
    });
}

/** Prisma where: TopUp policy Active with assignable Primary parent on asOfDate (UTC). */
export function topUpEffectivelyActivePrismaWhere(
    asOfDate: Date = startOfTodayUtc()
) {
    return {
        policy_kind: "TopUp" as const,
        status: "Active" as const,
        ParentInsurancePolicy: {
            is: {
                status: "Active" as const,
                start_date: { lte: asOfDate },
                end_date: { gte: asOfDate },
            },
        },
    };
}

/** Prisma where: Primary or TopUp effectively active on asOfDate (UTC). */
export function effectivelyActivePrismaWhere(
    asOfDate: Date = startOfTodayUtc()
) {
    return {
        OR: [
            primaryEffectivelyActivePrismaWhere(asOfDate),
            topUpEffectivelyActivePrismaWhere(asOfDate),
        ],
    };
}

export function canSetInsurancePolicyStatusActive(
    startDate: Date | string,
    endDate: Date | string,
    todayUtc: Date = startOfTodayUtc()
): boolean {
    return isTodayWithinInsurancePolicyTerm(startDate, endDate, todayUtc);
}

/**
 * Resolve auto_activate_on_term_start for Primary policies on save.
 * TopUp policies always false. Active/Draft → false.
 * Inactive with future start → body flag or default true.
 * Inactive within term → false (manual activation only).
 */
export function resolveAutoActivateOnTermStart(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    bodyFlag?: boolean | null;
    todayUtc?: Date;
}): boolean {
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

/**
 * Resolve status on policy update: block Active when outside the policy term.
 * Does not auto-activate when end_date is extended while Inactive.
 */
export function resolveInsurancePolicyStatusOnUpdate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus {
    if (args.policyKind === "TopUp") {
        return args.requestedStatus;
    }

    const today = args.todayUtc ?? startOfTodayUtc();

    if (
        args.requestedStatus === "Active" &&
        !canSetInsurancePolicyStatusActive(
            args.startDate,
            args.endDate,
            today
        )
    ) {
        if (isInsurancePolicyBeforeStartDate(args.startDate, today)) {
            throw new Error(
                "Cannot set status to Active before the policy start date"
            );
        }
        throw new Error(
            "Cannot set status to Active when end_date is before today"
        );
    }

    return args.requestedStatus;
}

/** Validate status on create (Primary policies). */
export function resolveInsurancePolicyStatusOnCreate(args: {
    policyKind: "Primary" | "TopUp";
    requestedStatus: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): InsurancePolicyLifecycleStatus {
    if (args.policyKind === "TopUp") {
        return args.requestedStatus;
    }

    const today = args.todayUtc ?? startOfTodayUtc();

    if (
        args.requestedStatus === "Active" &&
        !canSetInsurancePolicyStatusActive(
            args.startDate,
            args.endDate,
            today
        )
    ) {
        if (isInsurancePolicyBeforeStartDate(args.startDate, today)) {
            throw new Error(
                "Cannot set status to Active before the policy start date"
            );
        }
        throw new Error(
            "Cannot set status to Active when end_date is before today"
        );
    }

    return args.requestedStatus;
}

/** True when end_date was extended into a valid term while status remains Inactive. */
export function shouldNotifyPolicyEligibleForActivation(args: {
    policyKind: "Primary" | "TopUp";
    previousEndDate: Date | string | null;
    nextEndDate: Date | string;
    startDate: Date | string;
    status: InsurancePolicyLifecycleStatus;
    todayUtc?: Date;
}): boolean {
    if (args.policyKind !== "Primary" || args.status !== "Inactive") {
        return false;
    }
    if (!args.startDate || !args.nextEndDate) {
        return false;
    }
    const today = args.todayUtc ?? startOfTodayUtc();
    const endDateChanged =
        args.previousEndDate == null
            ? true
            : utcDateKey(args.previousEndDate) !== utcDateKey(args.nextEndDate);
    return (
        endDateChanged &&
        isTodayWithinInsurancePolicyTerm(
            args.startDate,
            args.nextEndDate,
            today
        )
    );
}

/** True when Inactive Primary is within term and can be manually activated. */
export function isPrimaryPolicyEligibleForManualActivation(args: {
    policyKind: "Primary" | "TopUp";
    status: InsurancePolicyLifecycleStatus;
    startDate: Date | string;
    endDate: Date | string;
    todayUtc?: Date;
}): boolean {
    if (args.policyKind !== "Primary" || args.status !== "Inactive") {
        return false;
    }
    return canSetInsurancePolicyStatusActive(
        args.startDate,
        args.endDate,
        args.todayUtc
    );
}
