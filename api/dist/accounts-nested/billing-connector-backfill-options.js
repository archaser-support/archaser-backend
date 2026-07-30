"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatBackfillStartDateForApi = formatBackfillStartDateForApi;
exports.areBackfillOptionsLocked = areBackfillOptionsLocked;
exports.normalizeBackfillStartDateInput = normalizeBackfillStartDateInput;
exports.resolveBackfillStartDateChange = resolveBackfillStartDateChange;
exports.resolveIncludeOlderOpenInvoicesChange = resolveIncludeOlderOpenInvoicesChange;
exports.resolveSkipReportingBreachOnBackfillChange = resolveSkipReportingBreachOnBackfillChange;
const CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function formatBackfillStartDateForApi(value) {
    if (!value) {
        return null;
    }
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function areBackfillOptionsLocked(backfillStartedAt) {
    return backfillStartedAt != null;
}
function normalizeBackfillStartDateInput(input) {
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
    if (utc.getUTCFullYear() !== year ||
        utc.getUTCMonth() !== month - 1 ||
        utc.getUTCDate() !== day) {
        throw Object.assign(new Error(`Invalid calendar date: ${trimmed}`), {
            statusCode: 400,
            code: "INVALID_BACKFILL_START_DATE",
        });
    }
    return utc;
}
function sameCalendarDay(a, b) {
    return (formatBackfillStartDateForApi(a ?? null) ===
        formatBackfillStartDateForApi(b ?? null));
}
function resolveBackfillStartDateChange(params) {
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
        message: "Backfill start date is locked after backfill has started. Reset backfill to change it.",
    };
}
function resolveIncludeOlderOpenInvoicesChange(params) {
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
        message: "Include older open invoices is locked after backfill has started. Reset backfill to change it.",
    };
}
function resolveSkipReportingBreachOnBackfillChange(params) {
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
        message: "Skip reporting breach during backfill is locked after backfill has started. Reset backfill to change it.",
    };
}
//# sourceMappingURL=billing-connector-backfill-options.js.map