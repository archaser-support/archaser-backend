/**
 * MEP (Maximum Extension of Payment) breach start date gate.
 *
 * A single predicate shared by every MEP caller — the live customer overdue
 * block (cause side), the created-terms-violation snapshot (flag side), and the
 * as-of replay — so the sides cannot drift apart.
 *
 * `BillingConnector.mep_breach_start_date` and `Invoice.invoice_date` are both
 * `@db.Date`, so this is a pure calendar-day comparison with no timezone rules.
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
 * Whether an invoice participates in MEP breach evaluation.
 *
 * No configured date means every invoice is in scope (behavior before the gate
 * existed). The boundary is inclusive: an invoice issued exactly on the
 * configured date is in scope.
 */
export function isInvoiceInMepBreachScope(
    invoiceDate: Date | string | null | undefined,
    mepBreachStartDate: Date | string | null | undefined
): boolean {
    if (mepBreachStartDate == null) {
        return true;
    }
    if (invoiceDate == null) {
        return true;
    }
    return (
        toComparableCalendarDay(invoiceDate).getTime() >=
        toComparableCalendarDay(mepBreachStartDate).getTime()
    );
}

/**
 * Drop out-of-scope invoices from a MEP candidate set. Returns the input array
 * untouched when no date is configured, so ungated accounts keep the exact
 * object identity and ordering they had before the gate existed.
 */
export function filterInvoicesInMepBreachScope<T>(
    invoices: T[],
    mepBreachStartDate: Date | null | undefined,
    invoiceDateOf: (invoice: T) => Date | string | null | undefined
): T[] {
    if (mepBreachStartDate == null) {
        return invoices;
    }
    return invoices.filter((invoice) =>
        isInvoiceInMepBreachScope(invoiceDateOf(invoice), mepBreachStartDate)
    );
}
