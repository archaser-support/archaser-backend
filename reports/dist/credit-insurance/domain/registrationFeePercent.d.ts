export declare const REGISTRATION_FEE_PERCENT_MIN = 0;
export declare const REGISTRATION_FEE_PERCENT_MAX = 100;
export type PolicyKindForRegistrationFee = "Primary" | "TopUp";
export type RegistrationFeePercentValidationErrorCode = "invalid_number" | "out_of_range";
export declare function parseRegistrationFeePercent(value: unknown, policyKind: PolicyKindForRegistrationFee): number | null;
export declare function validateRegistrationFeePercentFormField(raw: string, policyKind: PolicyKindForRegistrationFee): {
    value: number | null;
    error?: RegistrationFeePercentValidationErrorCode;
};
