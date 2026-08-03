import { Prisma } from "@prisma/client";

/** User-editable Policies-tab fields that trigger copy-on-write when changed. */
export const CUSTOMER_POLICY_VERSIONING_ALLOWLIST = [
    "insurance_policy_id",
    "customer_number_policy",
    "limit_type",
    "approved_limit",
    "approved_limit_currency",
    "approved_limit_expiration_date",
    "zero_limit_date",
    "max_payment_term",
    "max_allowed_mep",
    "reporting_days",
    "mep_cutoff_day_of_month",
    "mep_substitute_day_of_month",
    "reporting_cutoff_day_of_month",
    "reporting_substitute_day_of_month",
    "payment_term_cutoff_day_of_month",
    "payment_term_substitute_day_of_month",
    "excluded_from_policy",
    "policy_exclusion_reason",
    "credit_score",
    "credit_score_input_date",
    "active_customer_since",
] as const;

export type CustomerPolicyVersioningField =
    (typeof CUSTOMER_POLICY_VERSIONING_ALLOWLIST)[number];

export type CustomerPolicyVersioningSnapshot = Partial<
    Record<CustomerPolicyVersioningField, unknown>
>;

function normalizeString(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed === "" ? null : trimmed;
}

function decimalsEqual(a: unknown, b: unknown): boolean {
    const left =
        a === null || a === undefined || a === ""
            ? null
            : new Prisma.Decimal(String(a));
    const right =
        b === null || b === undefined || b === ""
            ? null
            : new Prisma.Decimal(String(b));
    if (left === null && right === null) {
        return true;
    }
    if (left === null || right === null) {
        return false;
    }
    return left.equals(right);
}

function datesEqual(a: unknown, b: unknown): boolean {
    const left =
        a === null || a === undefined || a === ""
            ? null
            : new Date(String(a));
    const right =
        b === null || b === undefined || b === ""
            ? null
            : new Date(String(b));
    if (left === null && right === null) {
        return true;
    }
    if (left === null || right === null) {
        return false;
    }
    if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) {
        return false;
    }
    return left.getTime() === right.getTime();
}

function numbersEqual(a: unknown, b: unknown): boolean {
    const left =
        a === null || a === undefined || a === ""
            ? null
            : Number(a);
    const right =
        b === null || b === undefined || b === ""
            ? null
            : Number(b);
    if (left === null && right === null) {
        return true;
    }
    if (left === null || right === null) {
        return false;
    }
    return left === right;
}

function customerPolicyFieldValuesEqual(
    before: unknown,
    after: unknown,
    field: CustomerPolicyVersioningField
): boolean {
    switch (field) {
        case "approved_limit":
        case "credit_score":
            return decimalsEqual(before, after);
        case "approved_limit_expiration_date":
        case "zero_limit_date":
        case "credit_score_input_date":
        case "active_customer_since":
            return datesEqual(before, after);
        case "insurance_policy_id":
        case "max_payment_term":
        case "max_allowed_mep":
        case "reporting_days":
        case "mep_cutoff_day_of_month":
        case "mep_substitute_day_of_month":
        case "reporting_cutoff_day_of_month":
        case "reporting_substitute_day_of_month":
        case "payment_term_cutoff_day_of_month":
        case "payment_term_substitute_day_of_month":
            return numbersEqual(before, after);
        case "excluded_from_policy":
            return Boolean(before) === Boolean(after);
        case "customer_number_policy":
        case "policy_exclusion_reason":
        case "approved_limit_currency":
        case "limit_type":
            return normalizeString(before) === normalizeString(after);
        default: {
            const _exhaustive: never = field;
            return _exhaustive;
        }
    }
}

export function hasMeaningfulCustomerPolicyFieldChange(
    before: CustomerPolicyVersioningSnapshot,
    after: CustomerPolicyVersioningSnapshot,
    allowlist: readonly CustomerPolicyVersioningField[] = CUSTOMER_POLICY_VERSIONING_ALLOWLIST
): boolean {
    return allowlist.some(
        (field) =>
            !customerPolicyFieldValuesEqual(before[field], after[field], field)
    );
}

export function pickCustomerPolicyVersioningSnapshot(
    source: CustomerPolicyVersioningSnapshot
): CustomerPolicyVersioningSnapshot {
    const snapshot: CustomerPolicyVersioningSnapshot = {};
    for (const field of CUSTOMER_POLICY_VERSIONING_ALLOWLIST) {
        snapshot[field] = source[field];
    }
    return snapshot;
}
