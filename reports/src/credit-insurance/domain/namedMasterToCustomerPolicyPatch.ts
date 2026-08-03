import type { Prisma } from "@prisma/client";

import type { CustomerPolicyWriteInput } from "./customerPolicyTypes";

export type NamedPolicyMasterFields = {
    customer_number: string;
    customer_max_limit: unknown;
    limit_expiration_date?: Date | null;
    max_payment_term: number | null;
    customer_mep: number | null;
    reporting_days: number | null;
};

function toApprovedLimit(
    value: unknown
): CustomerPolicyWriteInput["approved_limit"] {
    if (value === null || value === undefined) {
        return null;
    }
    return value as Prisma.Decimal | string | number;
}

export function resolveNamedPolicyCustomerNumber(args: {
    customerNumberPolicy: string | null | undefined;
    customerNumber: string | null | undefined;
}): string | null {
    const policyNumber = args.customerNumberPolicy?.trim();
    if (policyNumber) {
        return policyNumber;
    }
    const mainNumber = args.customerNumber?.trim();
    return mainNumber || null;
}

/** Maps active Named CustomerPolicy fields to NamedPolicy master input. */
export function customerPolicyToNamedMasterFields(
    assignment: {
        customer_number_policy: string | null | undefined;
        approved_limit: unknown;
        approved_limit_expiration_date?: Date | null;
        max_payment_term: number | null;
        max_allowed_mep: number | null;
        reporting_days: number | null;
    },
    customerNumber: string | null | undefined
): NamedPolicyMasterFields | null {
    const customer_number = resolveNamedPolicyCustomerNumber({
        customerNumberPolicy: assignment.customer_number_policy,
        customerNumber,
    });
    if (!customer_number) {
        return null;
    }

    return {
        customer_number,
        customer_max_limit: assignment.approved_limit,
        limit_expiration_date: assignment.approved_limit_expiration_date ?? null,
        max_payment_term: assignment.max_payment_term,
        customer_mep: assignment.max_allowed_mep,
        reporting_days: assignment.reporting_days,
    };
}

export function namedPolicyCustomerNumberMatchesAssignment(args: {
    masterCustomerNumber: string;
    customerNumberPolicy: string | null | undefined;
    customerNumber: string | null | undefined;
}): boolean {
    const masterKey = args.masterCustomerNumber.trim().toLowerCase();
    if (!masterKey) {
        return false;
    }
    const policyNumber = args.customerNumberPolicy?.trim().toLowerCase();
    const mainNumber = args.customerNumber?.trim().toLowerCase();
    return masterKey === policyNumber || masterKey === mainNumber;
}

/** Maps NamedPolicy master row fields to CustomerPolicy write input. */
export function namedMasterToCustomerPolicyPatch(
    master: NamedPolicyMasterFields,
    options?: { includeLimitType?: boolean }
): CustomerPolicyWriteInput {
    const patch: CustomerPolicyWriteInput = {
        customer_number_policy: master.customer_number.trim(),
        approved_limit: toApprovedLimit(master.customer_max_limit),
        approved_limit_expiration_date: master.limit_expiration_date ?? null,
        max_payment_term: master.max_payment_term,
        max_allowed_mep: master.customer_mep,
        reporting_days: master.reporting_days,
    };

    if (options?.includeLimitType !== false) {
        patch.limit_type = "Named";
    }

    return patch;
}
