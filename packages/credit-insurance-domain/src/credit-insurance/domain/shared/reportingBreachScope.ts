/**
 * Reporting breach start date gate.
 *
 * `BillingConnector.reporting_breach_start_date` is the first calendar day a
 * reporting breach may apply. Compare against the invoice's
 * `target_reporting_date` (not issue date): deadlines before the start date are
 * out of scope permanently. A missing configured date fails closed (out of
 * scope) — never treat null as “evaluate all history.”
 *
 * Both columns are `@db.Date`, so this is a pure calendar-day comparison with no
 * timezone rules.
 */
import { isInvoiceOnOrAfterStartDate } from "./calendarDayCompare";

/**
 * Whether an invoice participates in reporting breach evaluation.
 *
 * No configured date → out of scope (fail closed). The boundary is inclusive:
 * a target reporting date exactly on the configured day is in scope.
 */
export function isInvoiceInReportingBreachScope(
    targetReportingDate: Date | string | null | undefined,
    reportingBreachStartDate: Date | string | null | undefined
): boolean {
    if (reportingBreachStartDate == null) {
        return false;
    }
    return isInvoiceOnOrAfterStartDate(
        targetReportingDate,
        reportingBreachStartDate
    );
}
