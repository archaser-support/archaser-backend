export const REGISTRATION_FEE_PERCENT_MIN = 0;
export const REGISTRATION_FEE_PERCENT_MAX = 100;

export type PolicyKindForRegistrationFee = "Primary" | "TopUp";

export type RegistrationFeePercentValidationErrorCode =
    | "invalid_number"
    | "out_of_range";

function isBlankValue(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === "";
}

export function parseRegistrationFeePercent(
    value: unknown,
    policyKind: PolicyKindForRegistrationFee
): number | null {
    if (policyKind === "TopUp") {
        return null;
    }
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
        throw new Error("registration_fee_percent must be a valid number");
    }
    if (
        parsed < REGISTRATION_FEE_PERCENT_MIN ||
        parsed > REGISTRATION_FEE_PERCENT_MAX
    ) {
        throw new Error(
            `registration_fee_percent must be between ${REGISTRATION_FEE_PERCENT_MIN} and ${REGISTRATION_FEE_PERCENT_MAX}`
        );
    }
    return parsed;
}

export function validateRegistrationFeePercentFormField(
    raw: string,
    policyKind: PolicyKindForRegistrationFee
): { value: number | null; error?: RegistrationFeePercentValidationErrorCode } {
    if (policyKind === "TopUp") {
        return { value: null };
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return { value: null };
    }
    const parsed = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(parsed)) {
        return { value: null, error: "invalid_number" };
    }
    if (
        parsed < REGISTRATION_FEE_PERCENT_MIN ||
        parsed > REGISTRATION_FEE_PERCENT_MAX
    ) {
        return { value: null, error: "out_of_range" };
    }
    return { value: parsed };
}
