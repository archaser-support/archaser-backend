"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NULL_MONTH_END_CUTOFF_FIELDS = exports.DAY_OF_MONTH_MAX = exports.DAY_OF_MONTH_MIN = void 0;
exports.parseOptionalDayOfMonth = parseOptionalDayOfMonth;
exports.validateMonthEndCutoffPair = validateMonthEndCutoffPair;
exports.parseMonthEndCutoffFields = parseMonthEndCutoffFields;
exports.validateMonthEndCutoffFormFields = validateMonthEndCutoffFormFields;
exports.DAY_OF_MONTH_MIN = 1;
exports.DAY_OF_MONTH_MAX = 31;
exports.NULL_MONTH_END_CUTOFF_FIELDS = {
    mep_cutoff_day_of_month: null,
    mep_substitute_day_of_month: null,
    reporting_cutoff_day_of_month: null,
    reporting_substitute_day_of_month: null,
    payment_term_cutoff_day_of_month: null,
    payment_term_substitute_day_of_month: null,
};
function isBlankValue(value) {
    return value === null || value === undefined || value === "";
}
function parseOptionalDayOfMonth(value, fieldName) {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(`${fieldName} must be a valid integer`);
    }
    if (parsed < exports.DAY_OF_MONTH_MIN || parsed > exports.DAY_OF_MONTH_MAX) {
        throw new Error(`${fieldName} must be between ${exports.DAY_OF_MONTH_MIN} and ${exports.DAY_OF_MONTH_MAX}`);
    }
    return parsed;
}
function validateMonthEndCutoffPair(cutoff, substitute, pairLabel) {
    if (cutoff !== null && substitute === null) {
        throw new Error(`${pairLabel} substitute day is required when cutoff is set`);
    }
    if (substitute !== null && cutoff === null) {
        throw new Error(`${pairLabel} cutoff day is required when substitute is set`);
    }
}
function parseMonthEndCutoffFields(body) {
    const mep_cutoff_day_of_month = parseOptionalDayOfMonth(body.mep_cutoff_day_of_month, "mep_cutoff_day_of_month");
    const mep_substitute_day_of_month = parseOptionalDayOfMonth(body.mep_substitute_day_of_month, "mep_substitute_day_of_month");
    const reporting_cutoff_day_of_month = parseOptionalDayOfMonth(body.reporting_cutoff_day_of_month, "reporting_cutoff_day_of_month");
    const reporting_substitute_day_of_month = parseOptionalDayOfMonth(body.reporting_substitute_day_of_month, "reporting_substitute_day_of_month");
    const payment_term_cutoff_day_of_month = parseOptionalDayOfMonth(body.payment_term_cutoff_day_of_month, "payment_term_cutoff_day_of_month");
    const payment_term_substitute_day_of_month = parseOptionalDayOfMonth(body.payment_term_substitute_day_of_month, "payment_term_substitute_day_of_month");
    validateMonthEndCutoffPair(mep_cutoff_day_of_month, mep_substitute_day_of_month, "MEP");
    validateMonthEndCutoffPair(reporting_cutoff_day_of_month, reporting_substitute_day_of_month, "Reporting");
    validateMonthEndCutoffPair(payment_term_cutoff_day_of_month, payment_term_substitute_day_of_month, "Payment term");
    return {
        mep_cutoff_day_of_month,
        mep_substitute_day_of_month,
        reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month,
    };
}
function parseOptionalDayOfMonthFromString(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { value: null };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { value: null, error: "invalid_integer" };
    }
    if (parsed < exports.DAY_OF_MONTH_MIN || parsed > exports.DAY_OF_MONTH_MAX) {
        return { value: null, error: "out_of_range" };
    }
    return { value: parsed };
}
function validateMonthEndCutoffFormFields(args) {
    const errors = {};
    const mepCutoff = parseOptionalDayOfMonthFromString(args.mepCutoffRaw);
    const mepSubstitute = parseOptionalDayOfMonthFromString(args.mepSubstituteRaw);
    const reportingCutoff = parseOptionalDayOfMonthFromString(args.reportingCutoffRaw);
    const reportingSubstitute = parseOptionalDayOfMonthFromString(args.reportingSubstituteRaw);
    const paymentTermCutoff = parseOptionalDayOfMonthFromString(args.paymentTermCutoffRaw ?? "");
    const paymentTermSubstitute = parseOptionalDayOfMonthFromString(args.paymentTermSubstituteRaw ?? "");
    if (mepCutoff.error) {
        errors.mep_cutoff_day_of_month = mepCutoff.error;
    }
    if (mepSubstitute.error) {
        errors.mep_substitute_day_of_month = mepSubstitute.error;
    }
    if (reportingCutoff.error) {
        errors.reporting_cutoff_day_of_month = reportingCutoff.error;
    }
    if (reportingSubstitute.error) {
        errors.reporting_substitute_day_of_month = reportingSubstitute.error;
    }
    if (paymentTermCutoff.error) {
        errors.payment_term_cutoff_day_of_month = paymentTermCutoff.error;
    }
    if (paymentTermSubstitute.error) {
        errors.payment_term_substitute_day_of_month = paymentTermSubstitute.error;
    }
    if (!errors.mep_cutoff_day_of_month &&
        !errors.mep_substitute_day_of_month) {
        if (mepCutoff.value !== null && mepSubstitute.value === null) {
            errors.mep_substitute_day_of_month = "cutoff_requires_substitute";
        }
        else if (mepSubstitute.value !== null && mepCutoff.value === null) {
            errors.mep_cutoff_day_of_month = "substitute_requires_cutoff";
        }
    }
    if (!errors.reporting_cutoff_day_of_month &&
        !errors.reporting_substitute_day_of_month) {
        if (reportingCutoff.value !== null &&
            reportingSubstitute.value === null) {
            errors.reporting_substitute_day_of_month =
                "cutoff_requires_substitute";
        }
        else if (reportingSubstitute.value !== null &&
            reportingCutoff.value === null) {
            errors.reporting_cutoff_day_of_month = "substitute_requires_cutoff";
        }
    }
    if (!errors.payment_term_cutoff_day_of_month &&
        !errors.payment_term_substitute_day_of_month) {
        if (paymentTermCutoff.value !== null &&
            paymentTermSubstitute.value === null) {
            errors.payment_term_substitute_day_of_month =
                "cutoff_requires_substitute";
        }
        else if (paymentTermSubstitute.value !== null &&
            paymentTermCutoff.value === null) {
            errors.payment_term_cutoff_day_of_month = "substitute_requires_cutoff";
        }
    }
    return {
        fields: {
            mep_cutoff_day_of_month: mepCutoff.value,
            mep_substitute_day_of_month: mepSubstitute.value,
            reporting_cutoff_day_of_month: reportingCutoff.value,
            reporting_substitute_day_of_month: reportingSubstitute.value,
            payment_term_cutoff_day_of_month: paymentTermCutoff.value,
            payment_term_substitute_day_of_month: paymentTermSubstitute.value,
        },
        errors,
    };
}
//# sourceMappingURL=monthEndCutoffFields.js.map