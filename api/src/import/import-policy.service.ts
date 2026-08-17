import { Injectable } from "@nestjs/common";
import type { customer_limit_type } from "@prisma/client";
import { AccessScopeService } from "../auth/access-scope.service";
import { DatabaseService } from "../database/database.service";
import {
    DAY_OF_MONTH_MAX,
    DAY_OF_MONTH_MIN,
    type MonthEndCutoffFields,
    validateMonthEndCutoffPair,
} from "../credit-insurance/domain/shared/monthEndCutoffFields";
import {
    deriveExcludedFromPolicy,
    isAllowedPolicyExclusionReason,
    normalizePolicyExclusionReason,
} from "../credit-insurance/domain/shared/policyExclusion";
import { syncCustomerInsuranceFields } from "../credit-insurance/domain/syncCustomerInsuranceFields";

export type ImportPolicyRowInput = {
    policy_number?: unknown;
    customer_number?: unknown;
    limit_type?: unknown;
    customer_number_policy?: unknown;
    approved_limit?: unknown;
    approved_limit_expiration_date?: unknown;
    approved_limit_currency?: unknown;
    max_payment_term?: unknown;
    max_allowed_mep?: unknown;
    mep_cutoff_day_of_month?: unknown;
    mep_substitute_day_of_month?: unknown;
    reporting_days?: unknown;
    reporting_cutoff_day_of_month?: unknown;
    reporting_substitute_day_of_month?: unknown;
    payment_term_cutoff_day_of_month?: unknown;
    payment_term_substitute_day_of_month?: unknown;
    credit_score?: unknown;
    credit_score_input_date?: unknown;
    active_customer_since?: unknown;
    policy_exclusion_reason?: unknown;
};

export type ImportPolicyRowResult =
    | { success: true; action: "create" | "patch" | "switch"; customerId: number }
    | { success: false; errorCode: string; message: string };

type Prefill = {
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    approved_limit: unknown;
    approved_limit_expiration_date: Date | null;
    customer_number_policy: string | null;
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
};

function isBlank(value: unknown): boolean {
    return value == null || (typeof value === "string" && value.trim() === "");
}

function fail(errorCode: string, message: string): ImportPolicyRowResult {
    return { success: false, errorCode, message };
}

function limitType(value: unknown): customer_limit_type | null {
    const normalized = String(value ?? "").trim().toUpperCase();
    if (normalized === "DCL") return "DCL";
    if (normalized === "NAMED") return "Named";
    return null;
}

function dateOrError(
    value: unknown,
    field: string
): Date | null | ImportPolicyRowResult {
    if (isBlank(value)) return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime())
        ? fail("invalid_date", `import.validation.invalidDate:${field}`)
        : date;
}

function integerOrError(
    value: unknown,
    field: string
): number | null | ImportPolicyRowResult {
    if (isBlank(value)) return null;
    const parsed = Number(String(value).trim());
    return Number.isFinite(parsed) && Number.isInteger(parsed)
        ? parsed
        : fail("invalid_number", `import.validation.invalidNumber:${field}`);
}

function dayOrError(
    value: unknown,
    field: keyof MonthEndCutoffFields
): number | null | ImportPolicyRowResult {
    const parsed = integerOrError(value, field);
    if (isFailure(parsed)) {
        return fail(
            "invalid_month_end_day",
            `import.validation.invalidMonthEndDayOfMonth:${field}`
        );
    }
    if (parsed === null) return null;
    if (parsed < DAY_OF_MONTH_MIN || parsed > DAY_OF_MONTH_MAX) {
        return fail(
            "month_end_day_out_of_range",
            `import.validation.monthEndDayOutOfRange:${field}`
        );
    }
    return parsed;
}

function isFailure(value: unknown): value is ImportPolicyRowResult {
    return (
        typeof value === "object" &&
        value != null &&
        "success" in value &&
        (value as ImportPolicyRowResult).success === false
    );
}

function validateMonthEndFields(
    fields: MonthEndCutoffFields
): ImportPolicyRowResult | null {
    const pairs: Array<
        [
            keyof MonthEndCutoffFields,
            keyof MonthEndCutoffFields,
            string,
            string,
            string
        ]
    > = [
        [
            "mep_cutoff_day_of_month",
            "mep_substitute_day_of_month",
            "MEP",
            "mep_cutoff_requires_substitute",
            "mep_substitute_requires_cutoff",
        ],
        [
            "reporting_cutoff_day_of_month",
            "reporting_substitute_day_of_month",
            "Reporting",
            "reporting_cutoff_requires_substitute",
            "reporting_substitute_requires_cutoff",
        ],
        [
            "payment_term_cutoff_day_of_month",
            "payment_term_substitute_day_of_month",
            "Payment term",
            "payment_term_cutoff_requires_substitute",
            "payment_term_substitute_requires_cutoff",
        ],
    ];
    for (const [cutoffKey, substituteKey, label, cutoffCode, substituteCode] of pairs) {
        try {
            validateMonthEndCutoffPair(fields[cutoffKey], fields[substituteKey], label);
        } catch {
            const cutoffSet = fields[cutoffKey] != null;
            return fail(
                cutoffSet ? cutoffCode : substituteCode,
                `import.validation.${cutoffSet ? cutoffCode : substituteCode}`
            );
        }
    }
    return null;
}

@Injectable()
export class ImportPolicyService {
    private syncCustomer: (
        customerId: number,
        options?: { refreshTermsBreachFlags?: boolean }
    ) => Promise<void> = syncCustomerInsuranceFields;

    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async importPolicyRow(
        row: ImportPolicyRowInput,
        context: { accountId: number; userId: string; businessUnitId: number | null; role: string }
    ): Promise<ImportPolicyRowResult> {
        const policyNumber = String(row.policy_number ?? "").trim();
        const customerNumber = String(row.customer_number ?? "").trim();
        if (!policyNumber) {
            return fail("policy_number_required", "import.validation.policyNumberRequired");
        }
        if (!customerNumber) {
            return fail("customer_number_required", "import.validation.customerNumberRequired");
        }
        const parsedLimitType = limitType(row.limit_type);
        if (!parsedLimitType) {
            return fail("invalid_limit_type", "import.validation.invalidLimitType");
        }

        const exclusionReason = normalizePolicyExclusionReason(
            row.policy_exclusion_reason
        );
        if (
            exclusionReason !== null &&
            !isAllowedPolicyExclusionReason(exclusionReason)
        ) {
            return fail(
                "invalid_policy_exclusion_reason",
                "import.validation.invalidPolicyExclusionReason"
            );
        }

        const customer = await this.db.customer.findFirst({
            where: { account_id: context.accountId, customer_number: customerNumber },
            select: {
                id: true,
                country_id: true,
                customer_number: true,
                business_unit_id: true,
            },
        });
        if (!customer) {
            return fail(
                "customer_not_found",
                `import.validation.customerNotFound:${customerNumber}`
            );
        }

        const role = context.role;
        const isAdmin =
            this.accessScope.isAdminAccount(context.accountId) ||
            ["archaser_admin", "ARchaser Admin", "Admin", "System_Administrator", "System Administrator"].includes(role);
        const accessibleBusinessUnitIds = isAdmin
            ? null
            : context.businessUnitId == null
              ? []
              : [
                    context.businessUnitId,
                    ...(await this.accessScope.getBusinessUnitHierarchy(
                        context.businessUnitId
                    )),
                ];
        if (
            customer.business_unit_id != null &&
            accessibleBusinessUnitIds !== null &&
            !accessibleBusinessUnitIds.includes(customer.business_unit_id)
        ) {
            const businessUnit = await this.db.businessUnit.findFirst({
                where: { id: customer.business_unit_id },
                select: { external_id: true },
            });
            return fail(
                "business_unit_access_denied",
                `import.validation.businessUnitAccessDenied:${businessUnit?.external_id ?? `BU-${customer.business_unit_id}`}`
            );
        }

        const today = new Date();
        const policy = await this.db.insurancePolicy.findFirst({
            where: {
                account_id: context.accountId,
                policy_number: policyNumber,
                policy_kind: "Primary",
                status: "Active",
                start_date: { lte: today },
                end_date: { gte: today },
            },
            select: {
                id: true,
                max_payment_term: true,
                max_allowed_mep: true,
                reporting_days: true,
                mep_cutoff_day_of_month: true,
                mep_substitute_day_of_month: true,
                reporting_cutoff_day_of_month: true,
                reporting_substitute_day_of_month: true,
                payment_term_cutoff_day_of_month: true,
                payment_term_substitute_day_of_month: true,
                cost_percent: true,
                registration_fee_percent: true,
            },
        });
        if (!policy) {
            const exists = await this.db.insurancePolicy.findFirst({
                where: { account_id: context.accountId, policy_number: policyNumber },
                select: { policy_kind: true },
            });
            if (!exists) {
                return fail(
                    "policy_not_found",
                    `import.validation.policyNotFound:${policyNumber}`
                );
            }
            return fail(
                "policy_not_assignable",
                exists.policy_kind === "TopUp"
                    ? `import.validation.policyTopUpNotAssignable:${policyNumber}`
                    : `import.validation.policyNotAssignable:${policyNumber}`
            );
        }

        const customerNumberPolicy = isBlank(row.customer_number_policy)
            ? null
            : String(row.customer_number_policy).trim();
        // Customer was loaded by validated `customerNumber`; prefer explicit policy number.
        const namedCustomerNumber =
            customerNumberPolicy ?? customer.customer_number ?? customerNumber;
        let named = parsedLimitType === "Named"
            ? await this.db.namedPolicy.findFirst({
                  where: {
                      insurance_policy_id: policy.id,
                      customer_number: namedCustomerNumber,
                  },
              })
            : null;

        if (parsedLimitType === "Named" && !named) {
            const limitExpiration = dateOrError(
                row.approved_limit_expiration_date,
                "approved_limit_expiration_date"
            );
            if (isFailure(limitExpiration)) return limitExpiration;
            const maxPaymentTerm = integerOrError(row.max_payment_term, "max_payment_term");
            const maxAllowedMep = integerOrError(row.max_allowed_mep, "max_allowed_mep");
            const reportingDays = integerOrError(row.reporting_days, "reporting_days");
            if (isFailure(maxPaymentTerm) || isFailure(maxAllowedMep) || isFailure(reportingDays)) {
                return (isFailure(maxPaymentTerm)
                    ? maxPaymentTerm
                    : isFailure(maxAllowedMep)
                      ? maxAllowedMep
                      : reportingDays) as ImportPolicyRowResult;
            }
            try {
                named = await this.db.namedPolicy.create({
                    data: {
                        insurance_policy_id: policy.id,
                        customer_number: namedCustomerNumber,
                        customer_max_limit: isBlank(row.approved_limit)
                            ? null
                            : String(row.approved_limit).trim(),
                        limit_expiration_date: limitExpiration,
                        max_payment_term: maxPaymentTerm,
                        customer_mep: maxAllowedMep,
                        reporting_days: reportingDays,
                        created_by: context.userId,
                        modified_by: context.userId,
                    },
                });
            } catch (error) {
                if ((error as { code?: string }).code !== "P2002") throw error;
                named = await this.db.namedPolicy.findFirst({
                    where: {
                        insurance_policy_id: policy.id,
                        customer_number: namedCustomerNumber,
                    },
                });
                if (!named) throw error;
            }
        }

        const country = customer.country_id == null
            ? null
            : await this.db.insurancePolicyCountry.findFirst({
                  where: {
                      insurance_policy_id: policy.id,
                      country_id: customer.country_id,
                  },
              });
        const prefill: Prefill = {
            max_payment_term:
                named?.max_payment_term ?? country?.payment_term_cap ?? policy.max_payment_term ?? null,
            max_allowed_mep:
                named?.customer_mep ?? country?.country_mep ?? policy.max_allowed_mep ?? null,
            reporting_days:
                named?.reporting_days ?? country?.reporting_days ?? policy.reporting_days ?? null,
            approved_limit: named?.customer_max_limit ?? null,
            approved_limit_expiration_date: named?.limit_expiration_date ?? null,
            customer_number_policy: named?.customer_number ?? null,
            mep_cutoff_day_of_month: policy.mep_cutoff_day_of_month ?? null,
            mep_substitute_day_of_month: policy.mep_substitute_day_of_month ?? null,
            reporting_cutoff_day_of_month: policy.reporting_cutoff_day_of_month ?? null,
            reporting_substitute_day_of_month: policy.reporting_substitute_day_of_month ?? null,
            payment_term_cutoff_day_of_month: policy.payment_term_cutoff_day_of_month ?? null,
            payment_term_substitute_day_of_month: policy.payment_term_substitute_day_of_month ?? null,
        };

        const dateFields = [
            ["approved_limit_expiration_date", row.approved_limit_expiration_date],
            ["credit_score_input_date", row.credit_score_input_date],
            ["active_customer_since", row.active_customer_since],
        ] as const;
        const parsedDates = new Map<string, Date | null>();
        for (const [field, value] of dateFields) {
            const parsed = dateOrError(value, field);
            if (isFailure(parsed)) return parsed;
            parsedDates.set(field, parsed);
        }
        const numberFields = [
            ["max_payment_term", row.max_payment_term],
            ["max_allowed_mep", row.max_allowed_mep],
            ["reporting_days", row.reporting_days],
        ] as const;
        const parsedNumbers = new Map<string, number | null>();
        for (const [field, value] of numberFields) {
            const parsed = integerOrError(value, field);
            if (isFailure(parsed)) return parsed;
            parsedNumbers.set(field, parsed);
        }
        const monthEndFields: MonthEndCutoffFields = {
            mep_cutoff_day_of_month: null,
            mep_substitute_day_of_month: null,
            reporting_cutoff_day_of_month: null,
            reporting_substitute_day_of_month: null,
            payment_term_cutoff_day_of_month: null,
            payment_term_substitute_day_of_month: null,
        };
        for (const key of Object.keys(monthEndFields) as Array<keyof MonthEndCutoffFields>) {
            const parsed = dayOrError(row[key], key);
            if (isFailure(parsed)) return parsed;
            monthEndFields[key] = parsed ?? prefill[key];
        }
        const monthEndError = validateMonthEndFields(monthEndFields);
        if (monthEndError) return monthEndError;

        const explicitExclusionReason = row.policy_exclusion_reason !== undefined;
        const policyExclusionReason = explicitExclusionReason
            ? exclusionReason
            : parsedLimitType === "DCL"
              ? "Pending review"
              : undefined;
        const patch = {
            insurance_policy_id: policy.id,
            limit_type: parsedLimitType,
            customer_number_policy: customerNumberPolicy ?? prefill.customer_number_policy,
            approved_limit: isBlank(row.approved_limit) ? prefill.approved_limit : row.approved_limit,
            approved_limit_currency: isBlank(row.approved_limit_currency)
                ? undefined
                : String(row.approved_limit_currency).trim(),
            approved_limit_expiration_date: isBlank(row.approved_limit_expiration_date)
                ? prefill.approved_limit_expiration_date
                : parsedDates.get("approved_limit_expiration_date"),
            max_payment_term: isBlank(row.max_payment_term)
                ? prefill.max_payment_term
                : parsedNumbers.get("max_payment_term"),
            max_allowed_mep: isBlank(row.max_allowed_mep)
                ? prefill.max_allowed_mep
                : parsedNumbers.get("max_allowed_mep"),
            reporting_days: isBlank(row.reporting_days)
                ? prefill.reporting_days
                : parsedNumbers.get("reporting_days"),
            ...monthEndFields,
            ...(isBlank(row.credit_score) ? {} : { credit_score: row.credit_score }),
            ...(isBlank(row.credit_score_input_date)
                ? {}
                : { credit_score_input_date: parsedDates.get("credit_score_input_date") }),
            ...(isBlank(row.active_customer_since)
                ? {}
                : { active_customer_since: parsedDates.get("active_customer_since") }),
            ...(policyExclusionReason === undefined
                ? {}
                : {
                      policy_exclusion_reason: policyExclusionReason,
                      excluded_from_policy: deriveExcludedFromPolicy(policyExclusionReason),
                  }),
            cost_percent: policy.cost_percent,
            registration_fee_percent: policy.registration_fee_percent,
            modified_by: context.userId,
        };

        const activePolicy = await this.db.customerPolicy.findFirst({
            where: { customer_id: customer.id, is_active: true },
            select: { id: true, insurance_policy_id: true },
        });
        let action: "create" | "patch" | "switch";
        if (!activePolicy) {
            action = "create";
            await this.db.customerPolicy.create({
                data: {
                    customer_id: customer.id,
                    is_active: true,
                    created_by: context.userId,
                    ...patch,
                } as never,
            });
        } else if (activePolicy.insurance_policy_id === policy.id) {
            action = "patch";
            await this.db.customerPolicy.update({
                where: { id: activePolicy.id },
                data: patch as never,
            });
        } else {
            action = "switch";
            await this.db.$transaction(async (tx) => {
                await tx.customerPolicy.updateMany({
                    where: { customer_id: customer.id, is_active: true },
                    data: { is_active: false, modified_by: context.userId },
                });
                await tx.customerPolicy.create({
                    data: {
                        customer_id: customer.id,
                        is_active: true,
                        created_by: context.userId,
                        ...patch,
                    } as never,
                });
            });
        }

        try {
            await this.syncCustomer(customer.id, {
                refreshTermsBreachFlags: explicitExclusionReason,
            });
        } catch {
            // Do not turn a durable row import into a failed row outcome.
        }
        return { success: true, action, customerId: customer.id };
    }
}
