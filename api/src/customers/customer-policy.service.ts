import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import type { customer_limit_type, CustomerPolicy } from "@prisma/client";
import {
    deriveExcludedFromPolicy,
    freezeCustomerPolicyGapOnDeactivation,
    isAllowedPolicyExclusionReason,
    isPrimaryPolicyAssignable,
    normalizePolicyExclusionReason,
    syncCustomerInsuranceFields,
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
    "mep_cutoff_day_of_month",
    "mep_substitute_day_of_month",
    "reporting_cutoff_day_of_month",
    "reporting_substitute_day_of_month",
    "payment_term_cutoff_day_of_month",
    "payment_term_substitute_day_of_month",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "active_customer_since",
    "outdated_dcl",
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
    const date = new Date(String(value));
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
        mep_cutoff_day_of_month: row.mep_cutoff_day_of_month,
        mep_substitute_day_of_month: row.mep_substitute_day_of_month,
        reporting_cutoff_day_of_month: row.reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month: row.reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month: row.payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month:
            row.payment_term_substitute_day_of_month,
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
        mep_cutoff_day_of_month: payload.monthEnd.mep_cutoff_day_of_month,
        mep_substitute_day_of_month: payload.monthEnd.mep_substitute_day_of_month,
        reporting_cutoff_day_of_month:
            payload.monthEnd.reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month:
            payload.monthEnd.reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month:
            payload.monthEnd.payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month:
            payload.monthEnd.payment_term_substitute_day_of_month,
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
    },
    userId: string
): Record<string, unknown> {
    return {
        insurance_policy_id: payload.insurancePolicyId,
        customer_number_policy: payload.customer_number_policy,
        approved_limit: payload.approved_limit,
        approved_limit_expiration_date: payload.approved_limit_expiration_date,
        zero_limit_date: payload.zero_limit_date,
        limit_type: payload.limit_type,
        max_payment_term: payload.max_payment_term,
        max_allowed_mep: payload.max_allowed_mep,
        reporting_days: payload.reporting_days,
        ...payload.monthEnd,
        policy_exclusion_reason: payload.policy_exclusion_reason,
        excluded_from_policy: payload.excluded_from_policy,
        credit_score: payload.credit_score,
        credit_score_input_date: payload.credit_score_input_date,
        active_customer_since: payload.active_customer_since,
        outdated_dcl: payload.outdated_dcl,
        cost_percent: pricing.cost_percent,
        registration_fee_percent: pricing.registration_fee_percent,
        modified_by: userId,
    };
}

@Injectable()
export class CustomerPolicyService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * Policies-tab save path: create, switch, clear, or copy-on-write patch.
     */
    async applyFromPoliciesTabSave(args: {
        customerId: number;
        accountId: number;
        userId: string;
        body: Record<string, unknown>;
    }): Promise<"noop" | "create" | "patch" | "version" | "switch" | "clear"> {
        if (!hasPolicyPayloadInBody(args.body)) {
            return "noop";
        }

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
            await this.clearActivePolicy(args.customerId, activeRow.id, args.userId);
            await this.runPostSaveSync(args.customerId, payload);
            return "clear";
        }

        if (nextPolicyId == null) {
            return "noop";
        }

        const effectivePayload: CustomerPolicyTabPayload = {
            ...payload,
            insurancePolicyId: nextPolicyId,
        };

        await this.assertPolicyAssignable(nextPolicyId, args.accountId);

        if (effectivePayload.limit_type == null) {
            throw new BadRequestException({
                error: "limit_type is required when a policy is assigned",
            });
        }

        const pricing = await this.loadPolicyPricing(nextPolicyId, args.accountId);
        const writeData = buildPolicyWriteData(
            effectivePayload,
            pricing,
            args.userId
        );

        if (activeRow == null) {
            await this.db.customerPolicy.create({
                data: {
                    customer_id: args.customerId,
                    is_active: true,
                    created_by: args.userId,
                    ...writeData,
                } as never,
            });
            await this.runPostSaveSync(args.customerId, effectivePayload);
            return "create";
        }

        if (activePolicyId !== nextPolicyId) {
            if (!payload.confirmPolicySwitch) {
                throw new BadRequestException({
                    error: "Confirm policy switch before changing the active insurance policy",
                    code: "CONFIRM_POLICY_SWITCH_REQUIRED",
                });
            }
            await freezeCustomerPolicyGapOnDeactivation(
                args.customerId,
                activeRow.id,
                this.db
            );
            await this.db.$transaction(async (tx) => {
                await tx.customerPolicy.updateMany({
                    where: { customer_id: args.customerId, is_active: true },
                    data: { is_active: false, modified_by: args.userId },
                });
                await tx.customerPolicy.create({
                    data: {
                        customer_id: args.customerId,
                        is_active: true,
                        created_by: args.userId,
                        ...writeData,
                    } as never,
                });
            });
            await this.runPostSaveSync(args.customerId, effectivePayload);
            return "switch";
        }

        const beforeSnapshot = rowToVersioningSnapshot(activeRow);
        const afterSnapshot = payloadToVersioningSnapshot(effectivePayload);
        if (!hasMeaningfulCustomerPolicyFieldChange(beforeSnapshot, afterSnapshot)) {
            return "noop";
        }

        await freezeCustomerPolicyGapOnDeactivation(
            args.customerId,
            activeRow.id,
            this.db
        );
        await this.db.$transaction(async (tx) => {
            await tx.customerPolicy.update({
                where: { id: activeRow.id },
                data: { is_active: false, modified_by: args.userId },
            });
            await tx.customerPolicy.create({
                data: {
                    customer_id: args.customerId,
                    is_active: true,
                    created_by: args.userId,
                    approved_limit_currency: activeRow.approved_limit_currency,
                    ...writeData,
                } as never,
            });
        });
        await this.runPostSaveSync(args.customerId, effectivePayload);
        return "version";
    }

    private async clearActivePolicy(
        customerId: number,
        activeRowId: number,
        userId: string
    ): Promise<void> {
        await freezeCustomerPolicyGapOnDeactivation(
            customerId,
            activeRowId,
            this.db
        );
        await this.db.customerPolicy.updateMany({
            where: { customer_id: customerId, is_active: true },
            data: { is_active: false, modified_by: userId },
        });
    }

    private async assertPolicyAssignable(
        policyId: number,
        accountId: number
    ): Promise<void> {
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
    }

    private async loadPolicyPricing(policyId: number, accountId: number) {
        const policy = await this.db.insurancePolicy.findFirst({
            where: { id: policyId, account_id: accountId },
            select: {
                cost_percent: true,
                registration_fee_percent: true,
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
        await syncCustomerInsuranceFields(customerId, {
            dbClient: this.db,
            validateZeroLimitDate: true,
            refreshTermsBreachFlags: payload.explicitExclusionReason,
        });
    }
}
