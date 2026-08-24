"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REGISTRATION_FEE_PERCENT_MAX = exports.REGISTRATION_FEE_PERCENT_MIN = void 0;
exports.parseRegistrationFeePercent = parseRegistrationFeePercent;
exports.validateRegistrationFeePercentFormField = validateRegistrationFeePercentFormField;
exports.REGISTRATION_FEE_PERCENT_MIN = 0;
exports.REGISTRATION_FEE_PERCENT_MAX = 100;
function isBlankValue(value) {
    return value === null || value === undefined || String(value).trim() === "";
}
function parseRegistrationFeePercent(value, policyKind) {
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
    if (parsed < exports.REGISTRATION_FEE_PERCENT_MIN ||
        parsed > exports.REGISTRATION_FEE_PERCENT_MAX) {
        throw new Error(`registration_fee_percent must be between ${exports.REGISTRATION_FEE_PERCENT_MIN} and ${exports.REGISTRATION_FEE_PERCENT_MAX}`);
    }
    return parsed;
}
function validateRegistrationFeePercentFormField(raw, policyKind) {
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
    if (parsed < exports.REGISTRATION_FEE_PERCENT_MIN ||
        parsed > exports.REGISTRATION_FEE_PERCENT_MAX) {
        return { value: null, error: "out_of_range" };
    }
    return { value: parsed };
}
