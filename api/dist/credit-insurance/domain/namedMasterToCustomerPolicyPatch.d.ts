import type { CustomerPolicyWriteInput } from "./customerPolicyTypes";
export type NamedPolicyMasterFields = {
    customer_number: string;
    customer_max_limit: unknown;
    limit_expiration_date?: Date | null;
    max_payment_term: number | null;
    customer_mep: number | null;
    reporting_days: number | null;
};
export declare function resolveNamedPolicyCustomerNumber(args: {
    customerNumberPolicy: string | null | undefined;
    customerNumber: string | null | undefined;
}): string | null;
export declare function customerPolicyToNamedMasterFields(assignment: {
    customer_number_policy: string | null | undefined;
    approved_limit: unknown;
    approved_limit_expiration_date?: Date | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
}, customerNumber: string | null | undefined): NamedPolicyMasterFields | null;
export declare function namedPolicyCustomerNumberMatchesAssignment(args: {
    masterCustomerNumber: string;
    customerNumberPolicy: string | null | undefined;
    customerNumber: string | null | undefined;
}): boolean;
export declare function namedMasterToCustomerPolicyPatch(master: NamedPolicyMasterFields, options?: {
    includeLimitType?: boolean;
}): CustomerPolicyWriteInput;
