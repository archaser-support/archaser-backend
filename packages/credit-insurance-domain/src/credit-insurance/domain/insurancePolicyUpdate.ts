import {
    Prisma,
    type CustomerPolicy,
    type InsurancePolicy,
} from "@prisma/client";
import { parseAnnualCreditAssessmentFee } from "./annualCreditAssessmentFee";
import { enqueueAsOfRewrite } from "./asOfRewriteQueue";
import {
    listChangedPolicyPushFields,
    pickPolicyPushSnapshot,
    POLICY_PUSH_CUSTOMER_FIELDS,
    type PolicyPushCustomerField,
} from "./hasMeaningfulCustomerPolicyFieldChange";
import { applyInsurancePolicyCommercialTerms } from "./policyCommercialTerms";
import { planPolicyPushToCustomers } from "./policyPushCustomerPlan";
import { parseRegistrationFeePercent } from "./registrationFeePercent";
import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";
import { syncCustomerInsuranceFields } from "./syncCustomerInsuranceFields";
import { customerPolicySupersedeUpdateData } from "./customerPolicySupersede";
import { freezeCustomerPolicyGapOnDeactivation } from "./syncCustomerPolicyGapAmounts";

/** Invalid Insurance Policy save body; the API maps it to 400. */
export class InsurancePolicyUpdateDataError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InsurancePolicyUpdateDataError";
    }
}

export const INSURANCE_POLICY_PUSH_TRANSACTION_TIMEOUT_MS = 120_000;

/** Column values that clear the single pending Insurance Policy revision. */
export const CLEARED_INSURANCE_POLICY_PENDING_REVISION = {
    pending_effective_date: null,
    pending_payload: Prisma.DbNull,
    pending_created_at: null,
    pending_created_by: null,
} as const;

/** Match customers.parseDateOnly — YYYY-MM-DD → UTC midnight Date. */
function parseDateOnly(value: unknown): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (value == null) {
        return null;
    }
    const raw = String(value).trim();
    if (!raw) {
        return null;
    }
    const ymd = raw.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        return null;
    }
    const parsed = new Date(`${ymd}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function coercePolicyDateFields(data: Record<string, unknown>): void {
    for (const field of ["start_date", "end_date"] as const) {
        if (!(field in data)) {
            continue;
        }
        const value = data[field];
        if (value == null || value === "") {
            continue;
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            data[field] = new Date(
                Date.UTC(
                    value.getUTCFullYear(),
                    value.getUTCMonth(),
                    value.getUTCDate()
                )
            );
            continue;
        }
        const parsed = parseDateOnly(value);
        if (!parsed) {
            throw new InsurancePolicyUpdateDataError(
                `${field} must be YYYY-MM-DD`
            );
        }
        data[field] = parsed;
    }
}

/** TopUp UI omits term dates; DB requires them — drop nulls so update keeps existing values. */
export function omitNullTopUpTermDates(data: Record<string, unknown>): void {
    for (const field of ["start_date", "end_date"] as const) {
        if (field in data && (data[field] == null || data[field] === "")) {
            delete data[field];
        }
    }
}

/** Strip identity, audit and pending-revision keys from an entity PUT body. */
export function toInsuranceEntityUpdateData(
    body: Record<string, unknown>
): Record<string, unknown> {
    const data: Record<string, unknown> = { ...body };
    delete data.id;
    delete data.account_id;
    delete data.insurance_policy_id;
    delete data.created_at;
    delete data.created_by;
    delete data.InsurancePolicy;
    delete data.effective_date;
    delete data.pending_effective_date;
    delete data.pending_payload;
    delete data.pending_created_at;
    delete data.pending_created_by;
    delete data.pending_changed_fields;
    return data;
}

/** Normalize an Insurance Policy PUT body in place (dates, fees, commercial terms). */
export function prepareInsurancePolicyUpdateData(
    policy: Pick<InsurancePolicy, "policy_kind">,
    data: Record<string, unknown>
): void {
    coercePolicyDateFields(data);
    if (policy.policy_kind === "TopUp") {
        omitNullTopUpTermDates(data);
    }
    if ("registration_fee_percent" in data) {
        data.registration_fee_percent = parseRegistrationFeePercent(
            data.registration_fee_percent,
            policy.policy_kind
        );
    }
    if ("annual_credit_assessment_fee" in data) {
        data.annual_credit_assessment_fee = parseAnnualCreditAssessmentFee(
            data.annual_credit_assessment_fee,
            policy.policy_kind
        );
    }
    try {
        applyInsurancePolicyCommercialTerms(data, policy.policy_kind, {
            mode: "update",
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new InsurancePolicyUpdateDataError(
            message || "Invalid insurance policy commercial terms"
        );
    }
}

/** Active assignees on the policy plus customers that have a pending Customer Policy. */
export async function loadPolicyPushCandidates(
    client: Pick<Prisma.TransactionClient, "customerPolicy">,
    accountId: number,
    policyId: number
): Promise<{
    activeRows: CustomerPolicy[];
    pendingCustomerIds: Set<number>;
}> {
    const activeRows = await client.customerPolicy.findMany({
        where: {
            insurance_policy_id: policyId,
            is_active: true,
            Customer: { account_id: accountId },
        },
    });
    if (activeRows.length === 0) {
        return { activeRows, pendingCustomerIds: new Set() };
    }
    const pendingRows = await client.customerPolicy.findMany({
        where: {
            status: "pending",
            customer_id: {
                in: [...new Set(activeRows.map((row) => row.customer_id))],
            },
        },
        select: { customer_id: true },
    });
    return {
        activeRows,
        pendingCustomerIds: new Set(pendingRows.map((row) => row.customer_id)),
    };
}

export function buildCustomerPolicyVersionFromPolicyPush(args: {
    oldRow: CustomerPolicy;
    policy: InsurancePolicy;
    userId: string;
    /** Only these policy fields are overlaid; other push fields keep the customer value. */
    fieldsToPush: readonly PolicyPushCustomerField[];
    versionStartDate: Date;
}): Record<string, unknown> {
    const { oldRow, policy, userId, fieldsToPush } = args;
    const pushSet = new Set(fieldsToPush);
    const pushed: Record<string, unknown> = {};
    for (const field of POLICY_PUSH_CUSTOMER_FIELDS) {
        pushed[field] = pushSet.has(field) ? policy[field] : oldRow[field];
    }
    // A new version never starts before the row it replaces, or the
    // policy_change_start_date chain used for as-of terms would go backwards.
    const versionStartDate =
        oldRow.policy_change_start_date > args.versionStartDate
            ? oldRow.policy_change_start_date
            : args.versionStartDate;
    return {
        customer_id: oldRow.customer_id,
        is_active: true,
        status: "active",
        policy_change_start_date: versionStartDate,
        created_by: userId,
        modified_by: userId,
        insurance_policy_id: oldRow.insurance_policy_id,
        customer_number_policy: oldRow.customer_number_policy,
        approved_limit: oldRow.approved_limit,
        approved_limit_currency: oldRow.approved_limit_currency,
        approved_limit_expiration_date: oldRow.approved_limit_expiration_date,
        zero_limit_date: oldRow.zero_limit_date,
        limit_type: oldRow.limit_type,
        excluded_from_policy: oldRow.excluded_from_policy,
        policy_exclusion_reason: oldRow.policy_exclusion_reason,
        credit_score: oldRow.credit_score,
        credit_score_input_date: oldRow.credit_score_input_date,
        active_customer_since: oldRow.active_customer_since,
        outdated_dcl: oldRow.outdated_dcl,
        ...pushed,
    };
}

export type ApplyInsurancePolicyUpdateResult = {
    policy: InsurancePolicy;
    fieldsToPush: PolicyPushCustomerField[];
    versionedCustomerIds: number[];
    skippedPendingCustomerCount: number;
};

/**
 * Write prepared data onto the live Insurance Policy, then version active
 * Customer Policies with only the push fields that changed versus
 * `policyBefore` (customers with their own pending Customer Policy are
 * skipped). Run inside one transaction so policy + customer versions commit
 * or roll back together; follow with `enqueueInsurancePolicyUpdateAsOfRewrite`.
 */
export async function applyInsurancePolicyUpdateWithCustomerPush(args: {
    tx: Prisma.TransactionClient;
    accountId: number;
    policyBefore: InsurancePolicy;
    data: Record<string, unknown>;
    userId: string;
    customerVersionStartDate: Date;
}): Promise<ApplyInsurancePolicyUpdateResult> {
    const { tx, accountId, policyBefore, userId } = args;
    const policy = await tx.insurancePolicy.update({
        where: { id: policyBefore.id },
        data: { ...args.data, modified_by: userId } as never,
    });
    if (
        listChangedPolicyPushFields(
            pickPolicyPushSnapshot(policyBefore),
            pickPolicyPushSnapshot(policy)
        ).length === 0
    ) {
        return {
            policy,
            fieldsToPush: [],
            versionedCustomerIds: [],
            skippedPendingCustomerCount: 0,
        };
    }

    const { activeRows, pendingCustomerIds } = await loadPolicyPushCandidates(
        tx,
        accountId,
        policyBefore.id
    );
    const { fieldsToPush, rowsToVersion, skippedPendingCustomerCount } =
        planPolicyPushToCustomers({
            policyBefore,
            policyAfter: policy,
            activeRows,
            pendingCustomerIds,
        });

    for (const oldRow of rowsToVersion) {
        await freezeCustomerPolicyGapOnDeactivation(
            oldRow.customer_id,
            oldRow.id,
            tx as never
        );
        const versionStartDate =
            oldRow.policy_change_start_date > args.customerVersionStartDate
                ? oldRow.policy_change_start_date
                : args.customerVersionStartDate;
        await tx.customerPolicy.update({
            where: { id: oldRow.id },
            data: customerPolicySupersedeUpdateData({
                nextVersionStartDate: versionStartDate,
                modifiedBy: userId,
            }),
        });
        await tx.customerPolicy.create({
            data: buildCustomerPolicyVersionFromPolicyPush({
                oldRow,
                policy,
                userId,
                fieldsToPush,
                versionStartDate: args.customerVersionStartDate,
            }) as never,
        });

        // Same post-save sync as customer Policies tab (core + capacity gap).
        // Does not recompute invoice target_mep_date / target_reporting_date.
        await syncCustomerInsuranceFields(oldRow.customer_id, {
            dbClient: tx as never,
            validateZeroLimitDate: false,
        });
        await ensureCustomerCapacityGapStored(oldRow.customer_id, {
            dbClient: tx as never,
        });
    }

    return {
        policy,
        fieldsToPush,
        versionedCustomerIds: rowsToVersion.map((row) => row.customer_id),
        skippedPendingCustomerCount,
    };
}

/** Post-commit as-of rewrite for an Insurance Policy update (from the earlier term start). */
export async function enqueueInsurancePolicyUpdateAsOfRewrite(args: {
    accountId: number;
    before: Pick<InsurancePolicy, "start_date">;
    after: Pick<InsurancePolicy, "start_date">;
}): Promise<void> {
    await enqueueAsOfRewrite({
        accountId: args.accountId,
        fromDate:
            args.after.start_date < args.before.start_date
                ? args.after.start_date
                : args.before.start_date,
        toDate: new Date(),
    });
}
