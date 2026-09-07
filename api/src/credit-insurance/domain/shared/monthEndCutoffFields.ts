export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 31;
export const SUBSTITUTE_EXTRA_DAYS_MIN = 1;
export const SUBSTITUTE_EXTRA_DAYS_MAX = 365;

export type MonthEndCutoffFields = {
    mep_cutoff_day: number | null;
    mep_substitute_extra_days: number | null;
    reporting_cutoff_day: number | null;
    reporting_substitute_extra_days: number | null;
    payment_term_cutoff_day: number | null;
    payment_term_substitute_day: number | null;
};

export const NULL_MONTH_END_CUTOFF_FIELDS: MonthEndCutoffFields = {
    mep_cutoff_day: null,
    mep_substitute_extra_days: null,
    reporting_cutoff_day: null,
    reporting_substitute_extra_days: null,
    payment_term_cutoff_day: null,
    payment_term_substitute_day: null,
};

export type MonthEndCutoffValidationErrorCode =
    | "invalid_integer"
    | "out_of_range"
    | "cutoff_requires_substitute"
    | "substitute_requires_cutoff";

export type MonthEndCutoffFieldErrors = Partial<
    Record<keyof MonthEndCutoffFields, MonthEndCutoffValidationErrorCode>
>;

function isBlankValue(value: unknown): boolean {
    return value === null || value === undefined || value === "";
}

function parseOptionalBoundedInteger(
    value: unknown,
    fieldName: string,
    min: number,
    max: number
): number | null {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(`${fieldName} must be a valid integer`);
    }
    if (parsed < min || parsed > max) {
        throw new Error(`${fieldName} must be between ${min} and ${max}`);
    }
    return parsed;
}

export function parseOptionalDayOfMonth(
    value: unknown,
    fieldName: string
): number | null {
    return parseOptionalBoundedInteger(
        value,
        fieldName,
        DAY_OF_MONTH_MIN,
        DAY_OF_MONTH_MAX
    );
}

export function parseOptionalSubstituteExtraDays(
    value: unknown,
    fieldName: string
): number | null {
    return parseOptionalBoundedInteger(
        value,
        fieldName,
        SUBSTITUTE_EXTRA_DAYS_MIN,
        SUBSTITUTE_EXTRA_DAYS_MAX
    );
}

export function validateMonthEndCutoffPair(
    cutoff: number | null,
    substitute: number | null,
    pairLabel: string
): void {
    if (cutoff !== null && substitute === null) {
        throw new Error(
            `${pairLabel} substitute day is required when cutoff is set`
        );
    }
    if (substitute !== null && cutoff === null) {
        throw new Error(
            `${pairLabel} cutoff day is required when substitute is set`
        );
    }
}

export function parseMonthEndCutoffFields(
    body: Record<string, unknown>
): MonthEndCutoffFields {
    const mep_cutoff_day = parseOptionalDayOfMonth(
        body.mep_cutoff_day,
        "mep_cutoff_day"
    );
    const mep_substitute_extra_days = parseOptionalSubstituteExtraDays(
        body.mep_substitute_extra_days,
        "mep_substitute_extra_days"
    );
    const reporting_cutoff_day = parseOptionalDayOfMonth(
        body.reporting_cutoff_day,
        "reporting_cutoff_day"
    );
    const reporting_substitute_extra_days = parseOptionalSubstituteExtraDays(
        body.reporting_substitute_extra_days,
        "reporting_substitute_extra_days"
    );
    const payment_term_cutoff_day = parseOptionalDayOfMonth(
        body.payment_term_cutoff_day,
        "payment_term_cutoff_day"
    );
    const payment_term_substitute_day = parseOptionalDayOfMonth(
        body.payment_term_substitute_day,
        "payment_term_substitute_day"
    );

    validateMonthEndCutoffPair(
        mep_cutoff_day,
        mep_substitute_extra_days,
        "MEP"
    );
    validateMonthEndCutoffPair(
        reporting_cutoff_day,
        reporting_substitute_extra_days,
        "Reporting"
    );
    validateMonthEndCutoffPair(
        payment_term_cutoff_day,
        payment_term_substitute_day,
        "Payment term"
    );

    return {
        mep_cutoff_day,
        mep_substitute_extra_days,
        reporting_cutoff_day,
        reporting_substitute_extra_days,
        payment_term_cutoff_day,
        payment_term_substitute_day,
    };
}

function parseOptionalBoundedIntegerFromString(
    raw: string,
    min: number,
    max: number
): { value: number | null; error?: MonthEndCutoffValidationErrorCode } {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { value: null };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { value: null, error: "invalid_integer" };
    }
    if (parsed < min || parsed > max) {
        return { value: null, error: "out_of_range" };
    }
    return { value: parsed };
}

function parseOptionalDayOfMonthFromString(
    raw: string
): { value: number | null; error?: MonthEndCutoffValidationErrorCode } {
    return parseOptionalBoundedIntegerFromString(
        raw,
        DAY_OF_MONTH_MIN,
        DAY_OF_MONTH_MAX
    );
}

function parseOptionalSubstituteExtraDaysFromString(
    raw: string
): { value: number | null; error?: MonthEndCutoffValidationErrorCode } {
    return parseOptionalBoundedIntegerFromString(
        raw,
        SUBSTITUTE_EXTRA_DAYS_MIN,
        SUBSTITUTE_EXTRA_DAYS_MAX
    );
}

export function validateMonthEndCutoffFormFields(args: {
    mepCutoffRaw: string;
    mepSubstituteRaw: string;
    reportingCutoffRaw: string;
    reportingSubstituteRaw: string;
    paymentTermCutoffRaw?: string;
    paymentTermSubstituteRaw?: string;
}): { fields: MonthEndCutoffFields; errors: MonthEndCutoffFieldErrors } {
    const errors: MonthEndCutoffFieldErrors = {};

    const mepCutoff = parseOptionalDayOfMonthFromString(args.mepCutoffRaw);
    const mepSubstitute = parseOptionalSubstituteExtraDaysFromString(
        args.mepSubstituteRaw
    );
    const reportingCutoff = parseOptionalDayOfMonthFromString(
        args.reportingCutoffRaw
    );
    const reportingSubstitute = parseOptionalSubstituteExtraDaysFromString(
        args.reportingSubstituteRaw
    );
    const paymentTermCutoff = parseOptionalDayOfMonthFromString(
        args.paymentTermCutoffRaw ?? ""
    );
    const paymentTermSubstitute = parseOptionalDayOfMonthFromString(
        args.paymentTermSubstituteRaw ?? ""
    );

    if (mepCutoff.error) {
        errors.mep_cutoff_day = mepCutoff.error;
    }
    if (mepSubstitute.error) {
        errors.mep_substitute_extra_days = mepSubstitute.error;
    }
    if (reportingCutoff.error) {
        errors.reporting_cutoff_day = reportingCutoff.error;
    }
    if (reportingSubstitute.error) {
        errors.reporting_substitute_extra_days = reportingSubstitute.error;
    }
    if (paymentTermCutoff.error) {
        errors.payment_term_cutoff_day = paymentTermCutoff.error;
    }
    if (paymentTermSubstitute.error) {
        errors.payment_term_substitute_day = paymentTermSubstitute.error;
    }

    if (
        !errors.mep_cutoff_day &&
        !errors.mep_substitute_extra_days
    ) {
        if (mepCutoff.value !== null && mepSubstitute.value === null) {
            errors.mep_substitute_extra_days = "cutoff_requires_substitute";
        } else if (mepSubstitute.value !== null && mepCutoff.value === null) {
            errors.mep_cutoff_day = "substitute_requires_cutoff";
        }
    }

    if (
        !errors.reporting_cutoff_day &&
        !errors.reporting_substitute_extra_days
    ) {
        if (
            reportingCutoff.value !== null &&
            reportingSubstitute.value === null
        ) {
            errors.reporting_substitute_extra_days =
                "cutoff_requires_substitute";
        } else if (
            reportingSubstitute.value !== null &&
            reportingCutoff.value === null
        ) {
            errors.reporting_cutoff_day = "substitute_requires_cutoff";
        }
    }

    if (
        !errors.payment_term_cutoff_day &&
        !errors.payment_term_substitute_day
    ) {
        if (
            paymentTermCutoff.value !== null &&
            paymentTermSubstitute.value === null
        ) {
            errors.payment_term_substitute_day =
                "cutoff_requires_substitute";
        } else if (
            paymentTermSubstitute.value !== null &&
            paymentTermCutoff.value === null
        ) {
            errors.payment_term_cutoff_day = "substitute_requires_cutoff";
        }
    }

    return {
        fields: {
            mep_cutoff_day: mepCutoff.value,
            mep_substitute_extra_days: mepSubstitute.value,
            reporting_cutoff_day: reportingCutoff.value,
            reporting_substitute_extra_days: reportingSubstitute.value,
            payment_term_cutoff_day: paymentTermCutoff.value,
            payment_term_substitute_day: paymentTermSubstitute.value,
        },
        errors,
    };
}
