export declare const DAY_OF_MONTH_MIN = 1;
export declare const DAY_OF_MONTH_MAX = 31;
export type MonthEndCutoffFields = {
    mep_cutoff_day_of_month: number | null;
    mep_substitute_day_of_month: number | null;
    reporting_cutoff_day_of_month: number | null;
    reporting_substitute_day_of_month: number | null;
    payment_term_cutoff_day_of_month: number | null;
    payment_term_substitute_day_of_month: number | null;
};
export declare const NULL_MONTH_END_CUTOFF_FIELDS: MonthEndCutoffFields;
export type MonthEndCutoffValidationErrorCode = "invalid_integer" | "out_of_range" | "cutoff_requires_substitute" | "substitute_requires_cutoff";
export type MonthEndCutoffFieldErrors = Partial<Record<keyof MonthEndCutoffFields, MonthEndCutoffValidationErrorCode>>;
export declare function parseOptionalDayOfMonth(value: unknown, fieldName: string): number | null;
export declare function validateMonthEndCutoffPair(cutoff: number | null, substitute: number | null, pairLabel: string): void;
export declare function parseMonthEndCutoffFields(body: Record<string, unknown>): MonthEndCutoffFields;
export declare function validateMonthEndCutoffFormFields(args: {
    mepCutoffRaw: string;
    mepSubstituteRaw: string;
    reportingCutoffRaw: string;
    reportingSubstituteRaw: string;
    paymentTermCutoffRaw?: string;
    paymentTermSubstituteRaw?: string;
}): {
    fields: MonthEndCutoffFields;
    errors: MonthEndCutoffFieldErrors;
};
