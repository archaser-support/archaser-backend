/**
 * Reporting breach start date gate.
 *
 * Invoices issued before the account's `BillingConnector.backfill_start_date`
 * are imported history. Their reporting deadlines fall before the customer was
 * live on the system, so they must never be promoted to reporting breach.
 *
 * `backfill_start_date` and `Invoice.invoice_date` are both `@db.Date`, so this
 * is a pure calendar-day comparison with no timezone rules.
 */
import { isInvoiceOnOrAfterStartDate } from "./calendarDayCompare";

/**
 * Whether an invoice participates in reporting breach evaluation.
 *
 * No configured date means every invoice is in scope (behavior before the gate
 * existed). The boundary is inclusive: an invoice issued exactly on the
 * configured date is in scope.
 */
export function isInvoiceInReportingBreachScope(
    invoiceDate: Date | string | null | undefined,
    reportingBreachStartDate: Date | string | null | undefined
): boolean {
    return isInvoiceOnOrAfterStartDate(invoiceDate, reportingBreachStartDate);
}
