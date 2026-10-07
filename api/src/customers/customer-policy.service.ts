import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
    ServiceUnavailableException,
} from "@nestjs/common";
import {
    Prisma,
    type customer_limit_type,
    type customer_policy_status,
    type CustomerPolicy,
} from "@prisma/client";
import {
    AdminBackfillBlockingRewriteError,
    applyDatedCustomerPolicyUnassign,
    DatedCustomerPolicyUnassignError,
    deriveExcludedFromPolicy,
    ensureCustomerCapacityGapStored,
    freezeCustomerPolicyGapOnDeactivation,
    isAllowedPolicyExclusionReason,
    isLinkedCreditChild,
    isPrimaryPolicyAssignable,
    normalizePolicyExclusionReason,
    remirrorCreditPoolAfterPolicyMutation,
    rewriteCustomerAsOfRange,
    startOfTodayUtc,
    syncCustomerInsuranceFields,
    toUtcDateOnly,
} from "@archaser/credit-insurance-domain";
import { DatabaseService } from "../database/database.service";
import {
    hasMeaningfulCustomerPolicyFieldChange,
    pickCustomerPolicyVersioningSnapshot,
    type CustomerPolicyVersioningSnapshot,
} from "../credit-insurance/domain/hasMeaningfulCustomerPolicyFieldChange";
import {
    parseMonthEndCutoffFields,
    type MonthEndCutoffFields,
} from "../credit-insurance/domain/shared/monthEndCutoffFields";

/** Keys the Policies tab sends on customer PUT (legacy `policy_id` name). */
export const CUSTOMER_POLICY_BODY_KEYS = [
    "policy_id",
    "customer_number_policy",
    "approved_limit",
    "approved_limit_expiration_date",
    "zero_limit_date",
    "limit_type",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "mep_cutoff_day",
    "mep_substitute_extra_days",
    "reporting_cutoff_day",
    "reporting_substitute_extra_days",
    "payment_term_cutoff_day",
    "payment_term_substitute_day",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "active_customer_since",
    "outdated_dcl",
    "policy_change_start_date",
    "confirm_policy_switch",
] as const;

export type CustomerPolicyTabPayload = {
    insurancePolicyId: number | null;
    customer_number_policy: string | null;
    approved_limit: unknown;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    limit_type: customer_limit_type | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    monthEnd: MonthEndCutoffFields;
    policy_exclusion_reason: string | null;
    excluded_from_policy: boolean;
    credit_score: unknown;
    credit_score_input_date: Date | null;
    active_customer_since: Date | null;
    outdated_dcl: boolean;
    /** Required on create/version/switch; null when omitted (validated later). */
    policy_change_start_date: Date | null;
    confirmPolicySwitch: boolean;
    explicitExclusionReason: boolean;
};

function isBlank(value: unknown): boolean {
    return value == null || (typeof value === "string" && value.trim() === "");
}

function parseOptionalId(value: unknown): number | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalInt(value: unknown): number | null {
    if (isBlank(value)) {
        return null;
    }
    const n = Number(String(value).trim());
    return Number.isFinite(n) && Number.isInteger(n) ? n : null;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
    if (isBlank(value)) {
        return null;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return toUtcDateOnly(value);
    }
    const raw = String(value).trim();
    const ymd = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        throw new BadRequestException({
            error: `${field} must be a valid date (YYYY-MM-DD)`,
        });
    }
    const date = toUtcDateOnly(ymd);
    if (Number.isNaN(date.getTime())) {
        throw new BadRequestException({
            error: `${field} must be a valid date`,
        });
    }
    return date;
}

function parseLimitType(value: unknown): customer_limit_type | null {
    const normalized = String(value ?? "").trim();
    if (normalized === "DCL" || normalized === "Discretionary") {
        return "DCL";
    }
    if (normalized === "Named") {
        return "Named";
    }
    return null;
}

function parseDecimalOrNull(
    value: unknown,
    field: string
): Prisma.Decimal | null {
    if (isBlank(value)) {
        return null;
    }
    try {
        return new Prisma.Decimal(String(value).trim());
    } catch {
        throw new BadRequestException({
            error: `${field} must be a valid number`,
        });
    }
}

function assertZeroLimitDateWhenRequired(
    payload: CustomerPolicyTabPayload
): void {
    const limit = parseDecimalOrNull(payload.approved_limit, "approved_limit");
    if (limit == null) {
        return;
    }
    if (limit.equals(0) && payload.zero_limit_date == null) {
        throw new BadRequestException({
            error: "Approve zero limit date is required when approved limit is 0",
        });
    }
}

export function hasPolicyPayloadInBody(body: Record<string, unknown>): boolean {
    return CUSTOMER_POLICY_BODY_KEYS.some((key) => key in body);
}

export function stripPolicyFieldsFromBody(
    body: Record<string, unknown>
): Record<string, unknown> {
    const next = { ...body };
    for (const key of CUSTOMER_POLICY_BODY_KEYS) {
        delete next[key];
    }
    return next;
}

export function parseCustomerPolicyTabPayload(
    body: Record<string, unknown>
): CustomerPolicyTabPayload {
    let monthEnd: MonthEndCutoffFields;
    try {
        monthEnd = parseMonthEndCutoffFields(body);
    } catch (error) {
        throw new BadRequestException({
            error: error instanceof Error ? error.message : "Invalid month-end fields",
        });
    }

    const exclusionReason = normalizePolicyExclusionReason(
        body.policy_exclusion_reason
    );
    if (
        exclusionReason !== null &&
        !isAllowedPolicyExclusionReason(exclusionReason)
    ) {
        throw new BadRequestException({
            error: "Invalid policy exclusion reason",
        });
    }

    return {
        insurancePolicyId: parseOptionalId(body.policy_id),
        customer_number_policy: isBlank(body.customer_number_policy)
            ? null
            : String(body.customer_number_policy).trim(),
        approved_limit: isBlank(body.approved_limit) ? null : body.approved_limit,
        approved_limit_expiration_date: parseOptionalDate(
            body.approved_limit_expiration_date,
            "approved_limit_expiration_date"
        ),
        zero_limit_date: parseOptionalDate(body.zero_limit_date, "zero_limit_date"),
        limit_type: parseLimitType(body.limit_type),
        max_payment_term: parseOptionalInt(body.max_payment_term),
        max_allowed_mep: parseOptionalInt(body.max_allowed_mep),
        reporting_days: parseOptionalInt(body.reporting_days),
        monthEnd,
        policy_exclusion_reason: exclusionReason,
        excluded_from_policy: deriveExcludedFromPolicy(exclusionReason),
        credit_score: isBlank(body.credit_score) ? null : body.credit_score,
        credit_score_input_date: parseOptionalDate(
            body.credit_score_input_date,
            "credit_score_input_date"
        ),
        active_customer_since: parseOptionalDate(
            body.active_customer_since,
            "active_customer_since"
        ),
        outdated_dcl: Boolean(body.outdated_dcl),
        policy_change_start_date: parseOptionalDate(
            body.policy_change_start_date,
            "policy_change_start_date"
        ),
        confirmPolicySwitch: body.confirm_policy_switch === true,
        explicitExclusionReason: body.policy_exclusion_reason !== undefined,
    };
}

function rowToVersioningSnapshot(
    row: CustomerPolicy
): CustomerPolicyVersioningSnapshot {
    return pickCustomerPolicyVersioningSnapshot({
        insurance_policy_id: row.insurance_policy_id,
        customer_number_policy: row.customer_number_policy,
        limit_type: row.limit_type,
        approved_limit: row.approved_limit,
        approved_limit_currency: row.approved_limit_currency,
        approved_limit_expiration_date: row.approved_limit_expiration_date,
        zero_limit_date: row.zero_limit_date,
        max_payment_term: row.max_payment_term,
        max_allowed_mep: row.max_allowed_mep,
        reporting_days: row.reporting_days,
        mep_cutoff_day: row.mep_cutoff_day,
        mep_substitute_extra_days: row.mep_substitute_extra_days,
        reporting_cutoff_day: row.reporting_cutoff_day,
        reporting_substitute_extra_days: row.reporting_substitute_extra_days,
        payment_term_cutoff_day: row.payment_term_cutoff_day,
        payment_term_substitute_day:
            row.payment_term_substitute_day,
        excluded_from_policy: row.excluded_from_policy,
        policy_exclusion_reason: row.policy_exclusion_reason,
        credit_score: row.credit_score,
        credit_score_input_date: row.credit_score_input_date,
        active_customer_since: row.active_customer_since,
    });
}

function payloadToVersioningSnapshot(
    payload: CustomerPolicyTabPayload
): CustomerPolicyVersioningSnapshot {
    return pickCustomerPolicyVersioningSnapshot({
        insurance_policy_id: payload.insurancePolicyId,
        customer_number_policy: payload.customer_number_policy,
        limit_type: payload.limit_type,
        approved_limit: payload.approved_limit,
        approved_limit_expiration_date: payload.approved_limit_expiration_date,
        zero_limit_date: payload.zero_limit_date,
        max_payment_term: payload.max_payment_term,
        max_allowed_mep: payload.max_allowed_mep,
        reporting_days: payload.reporting_days,
        mep_cutoff_day: payload.monthEnd.mep_cutoff_day,
        mep_substitute_extra_days: payload.monthEnd.mep_substitute_extra_days,
        reporting_cutoff_day:
            payload.monthEnd.reporting_cutoff_day,
        reporting_substitute_extra_days:
            payload.monthEnd.reporting_substitute_extra_days,
        payment_term_cutoff_day:
            payload.monthEnd.payment_term_cutoff_day,
        payment_term_substitute_day:
            payload.monthEnd.payment_term_substitute_day,
        excluded_from_policy: payload.excluded_from_policy,
        policy_exclusion_reason: payload.policy_exclusion_reason,
        credit_score: payload.credit_score,
        credit_score_input_date: payload.credit_score_input_date,
        active_customer_since: payload.active_customer_since,
    });
}

function buildPolicyWriteData(
    payload: CustomerPolicyTabPayload,
    pricing: {
        cost_percent: unknown;
        registration_fee_percent: unknown;
        currency: string | null;
    },
    userId: string,
    policyChangeStartDate: Date,
    status: Extract<customer_policy_status, "active" | "pending">
): Record<string, unknown> {
    const isActive = status === "active";
    return {
        insurance_policy_id: payload.insurancePolicyId,
        customer_number_policy: payload.customer_number_policy,
        approved_limit: parseDecimalOrNull(
            payload.approved_limit,
            "approved_limit"
        ),
        approved_limit_currency: pricing.currency,
        approved_limit_expiration_date: payload.approved_limit_expiration_date,
        zero_limit_date: payload.zero_limit_date,
        limit_type: payload.limit_type,
        max_payment_term: payload.max_payment_term,
        max_allowed_mep: payload.max_allowed_mep,
        reporting_days: payload.reporting_days,
        ...payload.monthEnd,
        policy_exclusion_reason: payload.policy_exclusion_reason,
        excluded_from_policy: payload.excluded_from_policy,
        credit_score: parseDecimalOrNull(payload.credit_score, "credit_score"),
        credit_score_input_date: payload.credit_score_input_date,
        active_customer_since: payload.active_customer_since,
        outdated_dcl: payload.outdated_dcl,
        cost_percent: pricing.cost_percent,
        registration_fee_percent: pricing.registration_fee_percent,
        policy_change_start_date: policyChangeStartDate,
        status,
        is_active: isActive,
        modified_by: userId,
    };
}

@Injectable()
export class CustomerPolicyService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Policies-tab save path: create, switch, clear, copy-on-write patch, or
     * schedule a single pending future change (no rewrite until activation).
     */
    async applyFromPoliciesTabSave(args: {
        customerId: number;
        accountId: number;
        userId: string;
        body: Record<string, unknown>;
    }): Promise<
        | "noop"
        | "create"
        | "patch"
        | "version"
        | "switch"
        | "clear"
        | "pending"
        | "unassign"
    > {
        if (!hasPolicyPayloadInBody(args.body)) {
            return "noop";
        }

        if (await isLinkedCreditChild(args.customerId, this.db)) {
            throw new ForbiddenException({
                error: "Customer policy can only be edited on the credit pool root",
                code: "LINKED_CHILD_POLICY_LOCKED",
            });
        }

        await this.assertNoPendingPolicyChange(args.customerId);

        const payload = parseCustomerPolicyTabPayload(args.body);
        const activeRow = await this.db.customerPolicy.findFirst({
            where: { customer_id: args.customerId, is_active: true },
        });

        const activePolicyId = activeRow?.insurance_policy_id ?? null;
        const policyIdInBody = "policy_id" in args.body;
        const nextPolicyId = policyIdInBody
            ? payload.insurancePolicyId
            : activePolicyId;

        if (policyIdInBody && nextPolicyId == null) {
            if (activeRow == null) {
                return "noop";
            }
            throw new BadRequestException({
                error: "Use Remove policy to unassign. Clearing the insurance policy on Save is not supported.",
                code: "POLICY_UNASSIGN_REQUIRES_REMOVE",
            });
        }

        if (nextPolicyId == null) {
            return "noop";
        }

        const effectivePayload: CustomerPolicyTabPayload = {
            ...payload,
            insurancePolicyId: nextPolicyId,
        };

        const insurancePolicy = await this.assertPolicyAssignable(
            nextPolicyId,
            args.accountId
        );

        if (effectivePayload.limit_type == null) {
            throw new BadRequestException({
                error: "limit_type is required when a policy is assigned",
            });
        }

        assertZeroLimitDateWhenRequired(effectivePayload);

        const pricing = await this.loadPolicyPricing(nextPolicyId, args.accountId);
        const { changeDate, isFuture } = this.resolvePolicyChangeStartDate(
            effectivePayload.policy_change_start_date,
            insurancePolicy.start_date
        );

        if (isFuture) {
            if (activeRow != null) {
                const beforeSnapshot = rowToVersioningSnapshot(activeRow);
                const afterSnapshot =
                    payloadToVersioningSnapshot(effectivePayload);
                if (
                    !hasMeaningfulCustomerPolicyFieldChange(
                        beforeSnapshot,
                        afterSnapshot
                    )
                ) {
                    return "noop";
                }
            }
            const writeData = buildPolicyWriteData(
                effectivePayload,
                pricing,
                args.userId,
                changeDate,
                "pending"
            );
            await this.db.customerPolicy.create({
                data: {
                    customer_id: args.customerId,
                    created_by: args.userId,
                    ...writeData,
                } as never,
            });
            // Pending must not alter live insurance fields or enqueue rewrite.
            await this.remirrorPoolAfterMutation(args);
            return "pending";
        }

        if (activeRow == null) {
            const writeData = buildPolicyWriteData(
                effectivePayload,
                pricing,
                args.userId,
                changeDate,
                "active"
            );
            await this.db.customerPolicy.create({
                data: {
                    customer_id: args.customerId,
                    created_by: args.userId,
                    ...writeData,
                } as never,
            });
            await this.runPostSaveSync(args.customerId, effectivePayload);
            await this.rewriteFromChangeDate(
                args.accountId,
                args.customerId,
                changeDate
            );
            await this.remirrorPoolAfterMutation(args);
            return "create";
        }

        if (activePolicyId !== nextPolicyId) {
            if (!payload.confirmPolicySwitch) {
                throw new BadRequestException({
                    error: "Confirm policy switch before changing the active insurance policy",
                    code: "CONFIRM_POLICY_SWITCH_REQUIRED",
                });
            }
            const writeData = buildPolicyWriteData(
                effectivePayload,
                pricing,
                args.userId,
                changeDate,
                "active"
            );
            await freezeCustomerPolicyGapOnDeactivation(
                args.customerId,
                activeRow.id,
                this.db
            );
            await this.db.$transaction(async (tx) => {
                await tx.customerPolicy.updateMany({
                    where: { customer_id: args.customerId, is_active: true },
                    data: {
                        is_active: false,
                        status: "inactive",
                        modified_by: args.userId,
                    },
                });
                await tx.customerPolicy.create({
                    data: {
                        customer_id: args.customerId,
                        created_by: args.userId,
                        ...writeData,
                    } as never,
                });
            });
            await this.runPostSaveSync(args.customerId, effectivePayload);
            await this.rewriteFromChangeDate(
                args.accountId,
                args.customerId,
                changeDate
            );
            await this.remirrorPoolAfterMutation(args);
            return "switch";
        }

        const beforeSnapshot = rowToVersioningSnapshot(activeRow);
        const afterSnapshot = payloadToVersioningSnapshot(effectivePayload);
        if (!hasMeaningfulCustomerPolicyFieldChange(beforeSnapshot, afterSnapshot)) {
            return "noop";
        }

        const writeData = buildPolicyWriteData(
            effectivePayload,
            pricing,
            args.userId,
            changeDate,
            "active"
        );

        await freezeCustomerPolicyGapOnDeactivation(
            args.customerId,
            activeRow.id,
            this.db
        );
        await this.db.$transaction(async (tx) => {
            await tx.customerPolicy.update({
                where: { id: activeRow.id },
                data: {
                    is_active: false,
                    status: "inactive",
                    modified_by: args.userId,
                },
            });
            await tx.customerPolicy.create({
                data: {
                    customer_id: args.customerId,
                    created_by: args.userId,
                    approved_limit_currency: activeRow.approved_limit_currency,
                    ...writeData,
                } as never,
            });
        });
        await this.runPostSaveSync(args.customerId, effectivePayload);
        await this.rewriteFromChangeDate(
            args.accountId,
            args.customerId,
            changeDate
        );
        await this.remirrorPoolAfterMutation(args);
        return "version";
    }

    /**
     * Policies-tab Remove policy: past/today applies run-off; a future date
     * creates the single pending null-policy change (no rewrite until cron).
     */
    async applyUnassignFromPoliciesTab(args: {
        customerId: number;
        accountId: number;
        userId: string;
        unassignDate: unknown;
    }): Promise<{ customerPolicyId: number }> {
        try {
            return await applyDatedCustomerPolicyUnassign({
                customerId: args.customerId,
                accountId: args.accountId,
                userId: args.userId,
                unassignDate:
                    args.unassignDate == null
                        ? null
                        : parseOptionalDate(args.unassignDate, "unassign_date"),
                dbClient: this.db,
            });
        } catch (error) {
            this.rethrowUnassignError(error);
        }
    }

    /**
     * Soft-cancel the single pending future policy change (status → inactive).
     * Unlocks Policies-tab saves; row remains in history. No rewrite.
     */
    async cancelPendingPolicyChange(args: {
        customerId: number;
        accountId: number;
        userId: string;
    }): Promise<{ id: number }> {
        if (await isLinkedCreditChild(args.customerId, this.db)) {
            throw new ForbiddenException({
                error: "Customer policy can only be edited on the credit pool root",
                code: "LINKED_CHILD_POLICY_LOCKED",
            });
        }
        const pending = await this.db.customerPolicy.findFirst({
            where: { customer_id: args.customerId, status: "pending" },
            select: { id: true },
        });
        if (!pending) {
            throw new NotFoundException({
                error: "No pending policy change to cancel",
                code: "PENDING_POLICY_CHANGE_NOT_FOUND",
            });
        }
        await this.db.customerPolicy.update({
            where: { id: pending.id },
            data: {
                status: "inactive",
                is_active: false,
                modified_by: args.userId,
            },
        });
        await this.remirrorPoolAfterMutation({
            customerId: args.customerId,
            accountId: args.accountId,
            userId: args.userId,
        });
        return { id: pending.id };
    }

    private rethrowUnassignError(error: unknown): never {
        if (error instanceof DatedCustomerPolicyUnassignError) {
            switch (error.code) {
                case "LINKED_CHILD_POLICY_LOCKED":
                    throw new ForbiddenException({
                        error: error.message,
                        code: error.code,
                    });
                case "PENDING_POLICY_CHANGE_EXISTS":
                    throw new ConflictException({
                        error: error.message,
                        code: error.code,
                    });
                case "NO_ACTIVE_POLICY":
                    throw new NotFoundException({
                        error: error.message,
                        code: error.code,
                    });
                default:
                    throw new BadRequestException({
                        error: error.message,
                        code: error.code,
                    });
            }
        }
        if (
            error instanceof AdminBackfillBlockingRewriteError ||
            (error instanceof Error &&
                error.name === "AdminBackfillBlockingRewriteError")
        ) {
            throw new ConflictException({
                error: error instanceof Error ? error.message : String(error),
                code: "CREDIT_ASOF_BACKFILL_IN_PROGRESS",
            });
        }
        throw error;
    }

    private async remirrorPoolAfterMutation(args: {
        customerId: number;
        accountId: number;
        userId: string;
    }): Promise<void> {
        await remirrorCreditPoolAfterPolicyMutation(
            args.customerId,
            args.accountId,
            { dbClient: this.db, userId: args.userId }
        );
    }

    private async assertNoPendingPolicyChange(
        customerId: number
    ): Promise<void> {
        const pending = await this.db.customerPolicy.findFirst({
            where: { customer_id: customerId, status: "pending" },
            select: { id: true, policy_change_start_date: true },
        });
        if (pending) {
            throw new ConflictException({
                error: "A pending policy change exists. Cancel it before making further Policies changes.",
                code: "PENDING_POLICY_CHANGE_EXISTS",
            });
        }
    }

    private resolvePolicyChangeStartDate(
        value: Date | null,
        insurancePolicyStartDate: Date
    ): { changeDate: Date; isFuture: boolean } {
        if (value == null) {
            throw new BadRequestException({
                error: "policy_change_start_date is required",
                code: "POLICY_CHANGE_START_DATE_REQUIRED",
            });
        }
        const changeDate = toUtcDateOnly(value);
        const todayUtc = startOfTodayUtc();
        const policyStart = toUtcDateOnly(insurancePolicyStartDate);

        if (changeDate.getTime() < policyStart.getTime()) {
            throw new BadRequestException({
                error: "policy_change_start_date must be on or after the insurance policy start date",
                code: "POLICY_CHANGE_START_DATE_BEFORE_POLICY_START",
            });
        }
        return {
            changeDate,
            isFuture: changeDate.getTime() > todayUtc.getTime(),
        };
    }

    private async rewriteFromChangeDate(
        accountId: number,
        customerId: number,
        policyChangeStartDate: Date
    ): Promise<void> {
        // Option B: await CPT rewrite in-request; dashboard stays on overnight tip/drain.
        try {
            await rewriteCustomerAsOfRange(
                {
                    accountId,
                    customerIds: [customerId],
                    fromDate: policyChangeStartDate,
                    toDate: new Date(),
                },
                { dbClient: this.db }
            );
        } catch (error) {
            if (
                error instanceof AdminBackfillBlockingRewriteError ||
                (error instanceof Error &&
                    error.name === "AdminBackfillBlockingRewriteError")
            ) {
                throw new ConflictException({
                    error: error.message,
                    code: "CREDIT_ASOF_BACKFILL_IN_PROGRESS",
                });
            }
            throw new ServiceUnavailableException({
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to update customer policy trend history",
                code: "CUSTOMER_POLICY_TREND_REWRITE_FAILED",
            });
        }
    }

    private async assertPolicyAssignable(
        policyId: number,
        accountId: number
    ): Promise<{ id: number; start_date: Date }> {
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: {
                id: true,
                policy_kind: true,
                status: true,
                start_date: true,
                end_date: true,
            },
        });
        if (!policy) {
            throw new NotFoundException({ error: "Insurance policy not found" });
        }
        if (policy.policy_kind !== "Primary") {
            throw new BadRequestException({
                error: "Only primary insurance policies can be assigned to a customer",
            });
        }
        if (
            !isPrimaryPolicyAssignable({
                status: policy.status,
                startDate: policy.start_date,
                endDate: policy.end_date,
            })
        ) {
            throw new BadRequestException({
                error: "Insurance policy is not assignable",
            });
        }
        return { id: policy.id, start_date: policy.start_date };
    }

    private async loadPolicyPricing(policyId: number, accountId: number) {
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: {
                cost_percent: true,
                registration_fee_percent: true,
                currency: true,
            },
        });
        if (!policy) {
            throw new NotFoundException({ error: "Insurance policy not found" });
        }
        return policy;
    }

    private async runPostSaveSync(
        customerId: number,
        payload: CustomerPolicyTabPayload
    ): Promise<void> {
        try {
            await syncCustomerInsuranceFields(customerId, {
                dbClient: this.db,
                validateZeroLimitDate: false,
                refreshTermsBreachFlags: payload.explicitExclusionReason,
            });
            await ensureCustomerCapacityGapStored(customerId);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            throw new BadRequestException({
                error: message || "Failed to sync customer insurance fields",
            });
        }
    }
}
