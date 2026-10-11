import { toUtcDateOnly } from "@archaser/credit-insurance-domain";

export type InsurancePolicySaveEffectiveDateErrorCode =
    | "EFFECTIVE_DATE_INVALID"
    | "EFFECTIVE_DATE_IN_PAST";

export type InsurancePolicySaveEffectiveDate =
    | { ok: true; effectiveDate: Date; isFuture: boolean }
    | { ok: false; code: InsurancePolicySaveEffectiveDateErrorCode };

/**
 * Effective date of an Insurance Policy save (UTC calendar day). Omitted or
 * blank means today; past days are rejected so a policy push never rewrites
 * customer history. A future day schedules a pending revision.
 */
export function resolveInsurancePolicySaveEffectiveDate(
    raw: unknown,
    todayUtc: Date
): InsurancePolicySaveEffectiveDate {
    const today = toUtcDateOnly(todayUtc);
    if (raw == null || (typeof raw === "string" && raw.trim() === "")) {
        return { ok: true, effectiveDate: today, isFuture: false };
    }
    const text = raw instanceof Date ? raw.toISOString() : String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) {
        return { ok: false, code: "EFFECTIVE_DATE_INVALID" };
    }
    const effectiveDate = toUtcDateOnly(text);
    if (
        Number.isNaN(effectiveDate.getTime()) ||
        effectiveDate.toISOString().slice(0, 10) !== text.slice(0, 10)
    ) {
        return { ok: false, code: "EFFECTIVE_DATE_INVALID" };
    }
    if (effectiveDate.getTime() < today.getTime()) {
        return { ok: false, code: "EFFECTIVE_DATE_IN_PAST" };
    }
    return {
        ok: true,
        effectiveDate,
        isFuture: effectiveDate.getTime() > today.getTime(),
    };
}
