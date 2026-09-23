export type PolicyKindForCommercialTerms = "Primary" | "TopUp";

export type InsurancePolicyProductType = "TailorMade" | "Commodity";

export const INSURANCE_POLICY_PRODUCT_TYPES: readonly InsurancePolicyProductType[] =
    ["TailorMade", "Commodity"] as const;

export const COMMERCIAL_TERM_FIELD_NAMES = [
    "insured_percentage",
    "non_qualifying_loss_threshold",
    "minimum_premium",
    "minimum_premium_period_years",
    "aggregate_excess",
    "sdl_excess",
    "ncb_zero_claims_bonus_percent",
    "ncb_claims_ratio_threshold_percent",
    "ncb_up_to_threshold_bonus_percent",
    "product_type",
] as const;

export type CommercialTermFieldName =
    (typeof COMMERCIAL_TERM_FIELD_NAMES)[number];

const PERCENT_MIN = 0;
const PERCENT_MAX = 100;

function isBlankValue(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === "";
}

function parseOptionalNonNegativeMoney(
    value: unknown,
    fieldName: string
): number | null {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
        throw new Error(`${fieldName} must be a valid number`);
    }
    if (parsed < 0) {
        throw new Error(`${fieldName} must be greater than or equal to 0`);
    }
    return parsed;
}

function parseOptionalPercent(
    value: unknown,
    fieldName: string
): number | null {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
        throw new Error(`${fieldName} must be a valid number`);
    }
    if (parsed < PERCENT_MIN || parsed > PERCENT_MAX) {
        throw new Error(
            `${fieldName} must be between ${PERCENT_MIN} and ${PERCENT_MAX}`
        );
    }
    return parsed;
}

function parseOptionalPeriodYears(value: unknown): number | null {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim().replace(",", "."));
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(
            "minimum_premium_period_years must be a valid integer"
        );
    }
    if (parsed < 1) {
        throw new Error(
            "minimum_premium_period_years must be greater than or equal to 1"
        );
    }
    return parsed;
}

function parseOptionalProductType(
    value: unknown
): InsurancePolicyProductType | null {
    if (isBlankValue(value)) {
        return null;
    }
    const normalized = String(value).trim();
    if (
        !INSURANCE_POLICY_PRODUCT_TYPES.includes(
            normalized as InsurancePolicyProductType
        )
    ) {
        throw new Error(
            `product_type must be one of: ${INSURANCE_POLICY_PRODUCT_TYPES.join(", ")}`
        );
    }
    return normalized as InsurancePolicyProductType;
}

/**
 * Normalize Primary-only commercial terms on insurance-policy create/update.
 *
 * - TopUp always clears every commercial field to null.
 * - Primary: blank/empty → null; 0 money/percent stays 0 where allowed;
 *   rejects negatives and out-of-range percents when a value is provided.
 */
export function applyInsurancePolicyCommercialTerms(
    data: Record<string, unknown>,
    policyKind: PolicyKindForCommercialTerms,
    options: { mode: "create" | "update" }
): void {
    if (policyKind === "TopUp") {
        for (const field of COMMERCIAL_TERM_FIELD_NAMES) {
            data[field] = null;
        }
        return;
    }

    const shouldParse = (field: CommercialTermFieldName): boolean =>
        options.mode === "create" || field in data;

    if (shouldParse("insured_percentage")) {
        data.insured_percentage = parseOptionalPercent(
            data.insured_percentage,
            "insured_percentage"
        );
    }
    if (shouldParse("non_qualifying_loss_threshold")) {
        data.non_qualifying_loss_threshold = parseOptionalNonNegativeMoney(
            data.non_qualifying_loss_threshold,
            "non_qualifying_loss_threshold"
        );
    }
    if (shouldParse("minimum_premium")) {
        data.minimum_premium = parseOptionalNonNegativeMoney(
            data.minimum_premium,
            "minimum_premium"
        );
    }
    if (shouldParse("minimum_premium_period_years")) {
        data.minimum_premium_period_years = parseOptionalPeriodYears(
            data.minimum_premium_period_years
        );
    }
    if (shouldParse("aggregate_excess")) {
        data.aggregate_excess = parseOptionalNonNegativeMoney(
            data.aggregate_excess,
            "aggregate_excess"
        );
    }
    if (shouldParse("sdl_excess")) {
        data.sdl_excess = parseOptionalNonNegativeMoney(
            data.sdl_excess,
            "sdl_excess"
        );
    }
    if (shouldParse("ncb_zero_claims_bonus_percent")) {
        data.ncb_zero_claims_bonus_percent = parseOptionalPercent(
            data.ncb_zero_claims_bonus_percent,
            "ncb_zero_claims_bonus_percent"
        );
    }
    if (shouldParse("ncb_claims_ratio_threshold_percent")) {
        data.ncb_claims_ratio_threshold_percent = parseOptionalPercent(
            data.ncb_claims_ratio_threshold_percent,
            "ncb_claims_ratio_threshold_percent"
        );
    }
    if (shouldParse("ncb_up_to_threshold_bonus_percent")) {
        data.ncb_up_to_threshold_bonus_percent = parseOptionalPercent(
            data.ncb_up_to_threshold_bonus_percent,
            "ncb_up_to_threshold_bonus_percent"
        );
    }
    if (shouldParse("product_type")) {
        data.product_type = parseOptionalProductType(data.product_type);
    }
}
