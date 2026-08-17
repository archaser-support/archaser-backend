/**
 * Billing-connector cutover settings helpers for Nest get/upsert/reset parity.
 * Pull/filter engine stays on the live frontend sync path (not Nest).
 */

const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatBackfillStartDateForApi(
    value: Date | null | undefined
): string | null {
    if (!value) {
        return null;
    }
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

export function areBackfillOptionsLocked(
    backfillStartedAt: Date | null | undefined
): boolean {
    return backfillStartedAt != null;
}

/**
 * Normalize PUT input: undefined = omit, null/"" = clear, YYYY-MM-DD = set.
 * Stored as UTC midnight for the calendar day (@db.Date).
 */
export function normalizeBackfillStartDateInput(
    input: string | null | undefined
): Date | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null || (typeof input === "string" && input.trim() === "")) {
        return null;
    }

    const trimmed = String(input).trim();
    const match = CALENDAR_DATE_RE.exec(trimmed);
    if (!match) {
        throw Object.assign(new Error("backfill_start_date must be YYYY-MM-DD"), {
            statusCode: 400,
            code: "INVALID_BACKFILL_START_DATE",
        });
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (
        utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day
    ) {
        throw Object.assign(new Error(`Invalid calendar date: ${trimmed}`), {
            statusCode: 400,
            code: "INVALID_BACKFILL_START_DATE",
        });
    }
    return utc;
}

function sameCalendarDay(
    a: Date | null | undefined,
    b: Date | null | undefined
): boolean {
    return (
        formatBackfillStartDateForApi(a ?? null) ===
        formatBackfillStartDateForApi(b ?? null)
    );
}

export type BackfillStartDateChangeResult =
    | { ok: true; value: Date | null | undefined }
    | { ok: false; code: "BACKFILL_OPTIONS_LOCKED"; message: string };

export function resolveBackfillStartDateChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingStartDate: Date | null | undefined;
    nextInput: string | null | undefined;
}): BackfillStartDateChangeResult {
    if (params.nextInput === undefined) {
        return { ok: true, value: undefined };
    }

    const normalized = normalizeBackfillStartDateInput(params.nextInput);

    if (!areBackfillOptionsLocked(params.backfillStartedAt)) {
        return { ok: true, value: normalized ?? null };
    }

    if (sameCalendarDay(params.existingStartDate, normalized ?? null)) {
        return { ok: true, value: params.existingStartDate ?? null };
    }

    return {
        ok: false,
        code: "BACKFILL_OPTIONS_LOCKED",
        message:
            "Backfill start date is locked after backfill has started. Reset backfill to change it.",
    };
}

export type IncludeOlderOpenChangeResult =
    | { ok: true; value: boolean | undefined }
    | { ok: false; code: "BACKFILL_OPTIONS_LOCKED"; message: string };

export function resolveIncludeOlderOpenInvoicesChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingValue: boolean | undefined;
    nextInput: boolean | undefined;
}): IncludeOlderOpenChangeResult {
    if (params.nextInput === undefined) {
        return { ok: true, value: undefined };
    }

    const next = Boolean(params.nextInput);
    if (!areBackfillOptionsLocked(params.backfillStartedAt)) {
        return { ok: true, value: next };
    }

    const existing = params.existingValue ?? true;
    if (existing === next) {
        return { ok: true, value: existing };
    }

    return {
        ok: false,
        code: "BACKFILL_OPTIONS_LOCKED",
        message:
            "Include older open invoices is locked after backfill has started. Reset backfill to change it.",
    };
}

export type SkipReportingBreachChangeResult =
    | { ok: true; value: boolean | undefined }
    | { ok: false; code: "BACKFILL_OPTIONS_LOCKED"; message: string };

export function resolveSkipReportingBreachOnBackfillChange(params: {
    backfillStartedAt: Date | null | undefined;
    existingValue: boolean | undefined;
    nextInput: boolean | undefined;
}): SkipReportingBreachChangeResult {
    if (params.nextInput === undefined) {
        return { ok: true, value: undefined };
    }

    const next = Boolean(params.nextInput);
    if (!areBackfillOptionsLocked(params.backfillStartedAt)) {
        return { ok: true, value: next };
    }

    const existing = params.existingValue ?? false;
    if (existing === next) {
        return { ok: true, value: existing };
    }

    return {
        ok: false,
        code: "BACKFILL_OPTIONS_LOCKED",
        message:
            "Skip reporting breach during backfill is locked after backfill has started. Reset backfill to change it.",
    };
}
