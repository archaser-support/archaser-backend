export const DAY_OF_MONTH_MIN = 1;
export const DAY_OF_MONTH_MAX = 31;

export type MonthEndCutoffFields = {
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
};

export const NULL_MONTH_END_CUTOFF_FIELDS: MonthEndCutoffFields = {
    mep_cutoff_day_of_month: null,
    mep_substitute_day_of_month: null,
    reporting_cutoff_day_of_month: null,
    reporting_substitute_day_of_month: null,
    payment_term_cutoff_day_of_month: null,
    payment_term_substitute_day_of_month: null,
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

export function parseOptionalDayOfMonth(
    value: unknown,
    fieldName: string
): number | null {
    if (isBlankValue(value)) {
        return null;
    }
    const parsed = Number(String(value).trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new Error(`${fieldName} must be a valid integer`);
    }
    if (parsed < DAY_OF_MONTH_MIN || parsed > DAY_OF_MONTH_MAX) {
        throw new Error(
            `${fieldName} must be between ${DAY_OF_MONTH_MIN} and ${DAY_OF_MONTH_MAX}`
        );
    }
    return parsed;
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
    const mep_cutoff_day_of_month = parseOptionalDayOfMonth(
        body.mep_cutoff_day_of_month,
        "mep_cutoff_day_of_month"
    );
    const mep_substitute_day_of_month = parseOptionalDayOfMonth(
        body.mep_substitute_day_of_month,
        "mep_substitute_day_of_month"
    );
    const reporting_cutoff_day_of_month = parseOptionalDayOfMonth(
        body.reporting_cutoff_day_of_month,
        "reporting_cutoff_day_of_month"
    );
    const reporting_substitute_day_of_month = parseOptionalDayOfMonth(
        body.reporting_substitute_day_of_month,
        "reporting_substitute_day_of_month"
    );
    const payment_term_cutoff_day_of_month = parseOptionalDayOfMonth(
        body.payment_term_cutoff_day_of_month,
        "payment_term_cutoff_day_of_month"
    );
    const payment_term_substitute_day_of_month = parseOptionalDayOfMonth(
        body.payment_term_substitute_day_of_month,
        "payment_term_substitute_day_of_month"
    );

    validateMonthEndCutoffPair(
        mep_cutoff_day_of_month,
        mep_substitute_day_of_month,
        "MEP"
    );
    validateMonthEndCutoffPair(
        reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month,
        "Reporting"
    );
    validateMonthEndCutoffPair(
        payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month,
        "Payment term"
    );

    return {
        mep_cutoff_day_of_month,
        mep_substitute_day_of_month,
        reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month,
    };
}

function parseOptionalDayOfMonthFromString(
    raw: string
): { value: number | null; error?: MonthEndCutoffValidationErrorCode } {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { value: null };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        return { value: null, error: "invalid_integer" };
    }
    if (parsed < DAY_OF_MONTH_MIN || parsed > DAY_OF_MONTH_MAX) {
        return { value: null, error: "out_of_range" };
    }
    return { value: parsed };
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
    const mepSubstitute = parseOptionalDayOfMonthFromString(
        args.mepSubstituteRaw
    );
    const reportingCutoff = parseOptionalDayOfMonthFromString(
        args.reportingCutoffRaw
    );
    const reportingSubstitute = parseOptionalDayOfMonthFromString(
        args.reportingSubstituteRaw
    );
    const paymentTermCutoff = parseOptionalDayOfMonthFromString(
        args.paymentTermCutoffRaw ?? ""
    );
    const paymentTermSubstitute = parseOptionalDayOfMonthFromString(
        args.paymentTermSubstituteRaw ?? ""
    );

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

    if (
        !errors.mep_cutoff_day_of_month &&
        !errors.mep_substitute_day_of_month
    ) {
        if (mepCutoff.value !== null && mepSubstitute.value === null) {
            errors.mep_substitute_day_of_month = "cutoff_requires_substitute";
        } else if (mepSubstitute.value !== null && mepCutoff.value === null) {
            errors.mep_cutoff_day_of_month = "substitute_requires_cutoff";
        }
    }

    if (
        !errors.reporting_cutoff_day_of_month &&
        !errors.reporting_substitute_day_of_month
    ) {
        if (
            reportingCutoff.value !== null &&
            reportingSubstitute.value === null
        ) {
            errors.reporting_substitute_day_of_month =
                "cutoff_requires_substitute";
        } else if (
            reportingSubstitute.value !== null &&
            reportingCutoff.value === null
        ) {
            errors.reporting_cutoff_day_of_month = "substitute_requires_cutoff";
        }
    }

    if (
        !errors.payment_term_cutoff_day_of_month &&
        !errors.payment_term_substitute_day_of_month
    ) {
        if (
            paymentTermCutoff.value !== null &&
            paymentTermSubstitute.value === null
        ) {
            errors.payment_term_substitute_day_of_month =
                "cutoff_requires_substitute";
        } else if (
            paymentTermSubstitute.value !== null &&
            paymentTermCutoff.value === null
        ) {
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
