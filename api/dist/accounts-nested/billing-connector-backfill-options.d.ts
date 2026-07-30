export declare function formatBackfillStartDateForApi(value: Date | null | undefined): string | null;
export declare function areBackfillOptionsLocked(backfillStartedAt: Date | null | undefined): boolean;
export declare function normalizeBackfillStartDateInput(input: string | null | undefined): Date | null | undefined;
export type BackfillStartDateChangeResult = {
    ok: true;
    value: Date | null | undefined;
} | {
    ok: false;
    code: "BACKFILL_OPTIONS_LOCKED";
    message: string;
};
export declare function resolveBackfillStartDateChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingStartDate: Date | null | undefined;
    nextInput: string | null | undefined;
}): BackfillStartDateChangeResult;
export type IncludeOlderOpenChangeResult = {
    ok: true;
    value: boolean | undefined;
} | {
    ok: false;
    code: "BACKFILL_OPTIONS_LOCKED";
    message: string;
};
export declare function resolveIncludeOlderOpenInvoicesChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingValue: boolean | undefined;
    nextInput: boolean | undefined;
}): IncludeOlderOpenChangeResult;
export type SkipReportingBreachChangeResult = {
    ok: true;
    value: boolean | undefined;
} | {
    ok: false;
    code: "BACKFILL_OPTIONS_LOCKED";
    message: string;
};
export declare function resolveSkipReportingBreachOnBackfillChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingValue: boolean | undefined;
    nextInput: boolean | undefined;
}): SkipReportingBreachChangeResult;
