/**
 * Calendar-day "breach start date" gate shared by breach evaluators.
 *
 * An account can be onboarded with historical invoices that predate the data we
 * actually hold. Those invoices must not produce breaches, because the events
 * that would have cleared them (a reporting filing, a payment) were never
 * imported. Each breach family resolves its own start date, but they all decide
 * membership with the predicate here so the sides cannot drift apart.
 *
 * The connector date columns and `Invoice.invoice_date` are all `@db.Date`, so
 * this is a pure calendar-day comparison with no timezone rules.
 */
import { normalizeCalendarDayForInsuranceCompare } from "./calendarDayCompare";

function toComparableCalendarDay(value: Date | string): Date {
    if (typeof value === "string") {
        const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
        if (ymd) {
            return new Date(
                Number(ymd[1]),
                Number(ymd[2]) - 1,
                Number(ymd[3])
            );
        }
    }
    const date = value instanceof Date ? value : new Date(value);
    return normalizeCalendarDayForInsuranceCompare(date);
}

/**
 * Whether an invoice is on or after a configured breach start date.
 *
 * No configured date means every invoice is in scope (behavior before the gates
 * existed). A missing invoice date is also in scope, so an incomplete row keeps
 * being evaluated rather than silently dropping out. The boundary is inclusive:
 * an invoice issued exactly on the configured date is in scope.
 */
export function isInvoiceOnOrAfterBreachStartDate(
    invoiceDate: Date | string | null | undefined,
    breachStartDate: Date | string | null | undefined
): boolean {
    if (breachStartDate == null) {
        return true;
    }
    if (invoiceDate == null) {
        return true;
    }
    return (
        toComparableCalendarDay(invoiceDate).getTime() >=
        toComparableCalendarDay(breachStartDate).getTime()
    );
}

/**
 * Drop out-of-scope invoices from a candidate set. Returns the input array
 * untouched when no date is configured, so ungated accounts keep the exact
 * object identity and ordering they had before the gates existed.
 */
export function filterInvoicesOnOrAfterBreachStartDate<T>(
    invoices: T[],
    breachStartDate: Date | null | undefined,
    invoiceDateOf: (invoice: T) => Date | string | null | undefined
): T[] {
    if (breachStartDate == null) {
        return invoices;
    }
    return invoices.filter((invoice) =>
        isInvoiceOnOrAfterBreachStartDate(invoiceDateOf(invoice), breachStartDate)
    );
}
