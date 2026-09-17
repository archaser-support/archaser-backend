/**
 * Reporting breach start date gate.
 *
 * Invoices issued before the account's `BillingConnector.reporting_breach_start_date`
 * must never be promoted to reporting breach. A missing configured date fails closed
 * (out of scope) — never treat null as “evaluate all history.”
 *
 * `reporting_breach_start_date` and `Invoice.invoice_date` are both `@db.Date`, so this
 * is a pure calendar-day comparison with no timezone rules.
 */
import { isInvoiceOnOrAfterStartDate } from "./calendarDayCompare";

/**
 * Whether an invoice participates in reporting breach evaluation.
 *
 * No configured date → out of scope (fail closed). The boundary is inclusive:
 * an invoice issued exactly on the configured date is in scope.
 */
export function isInvoiceInReportingBreachScope(
    invoiceDate: Date | string | null | undefined,
    reportingBreachStartDate: Date | string | null | undefined
): boolean {
    if (reportingBreachStartDate == null) {
        return false;
    }
    return isInvoiceOnOrAfterStartDate(invoiceDate, reportingBreachStartDate);
}
