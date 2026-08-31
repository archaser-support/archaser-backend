/**
 * MEP (Maximum Extension of Payment) breach start date gate.
 *
 * A single predicate shared by every MEP caller — the live customer overdue
 * block (cause side), the created-terms-violation snapshot (flag side), and the
 * as-of replay — so the sides cannot drift apart.
 *
 * The calendar-day comparison itself lives in {@link ./breachStartDateScope},
 * shared with the reporting-breach gate.
 */
import {
    filterInvoicesOnOrAfterBreachStartDate,
    isInvoiceOnOrAfterBreachStartDate,
} from "./breachStartDateScope";

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
    return isInvoiceOnOrAfterBreachStartDate(invoiceDate, mepBreachStartDate);
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
    return filterInvoicesOnOrAfterBreachStartDate(
        invoices,
        mepBreachStartDate,
        invoiceDateOf
    );
}
