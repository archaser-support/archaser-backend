import { parseErpDateOnly } from "../utils/connectorFieldUtils";

export type InvoicePaymentCloseDates = {
    last_payment_date: Date | null;
    close_date: Date | null;
};

/** Latest non-null payment_date among linked payments (includes virtual). */
export function maxPaymentDate(
    paymentDates: Array<Date | null | undefined>
): Date | null {
    let max: Date | null = null;
    for (const date of paymentDates) {
        if (!date || Number.isNaN(date.getTime())) {
            continue;
        }
        if (max === null || date > max) {
            max = date;
        }
    }
    return max;
}

/** UTC calendar day from a timestamptz (or date) for `@db.Date` columns. */
export function calendarDateFromTimestamp(value: Date): Date {
    const parsed = parseErpDateOnly(value);
    if (parsed) {
        return parsed;
    }
    return new Date(`${value.toISOString().slice(0, 10)}T00:00:00.000Z`);
}

/**
 * Resolve denormalized last payment / close dates.
 * - last_payment_date: MAX(payment_date), or modifiedAt day when Paid with no payments
 * - close_date: same as last_payment_date when Paid; otherwise null
 */
export function resolveInvoicePaymentCloseDates(input: {
    status: string;
    paymentDates: Array<Date | null | undefined>;
    modifiedAt: Date;
}): InvoicePaymentCloseDates {
    const fromPayments = maxPaymentDate(input.paymentDates);
    const isPaid = input.status === "Paid";

    if (isPaid) {
        const day = fromPayments ?? calendarDateFromTimestamp(input.modifiedAt);
        return {
            last_payment_date: day,
            close_date: day,
        };
    }

    return {
        last_payment_date: fromPayments,
        close_date: null,
    };
}
