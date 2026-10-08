import { isWithinPaidTolerance } from "./invoicePaidTolerance";
import { toMoneyNumber } from "../payment/moneyNumber";

export type FutureCoverPayment = {
    payment_date: Date;
    customer_amount: unknown;
};

export type FutureCoverInvoice = {
    customer_net_amount: number | null;
};

/**
 * True when the invoice has at least one linked payment with `payment_date > asOf`
 * and applying all linked payments (as if matured) would leave customer outstanding
 * within paid tolerance — same customer-side Paid-close math.
 *
 * Partial future cover returns false so residual debt stays collectible.
 */
export function isInvoiceFullyCoveredByFuturePayments(
    invoice: FutureCoverInvoice,
    linkedPayments: FutureCoverPayment[],
    paidTolerance: number,
    asOf: Date = new Date()
): boolean {
    const asOfMs = asOf.getTime();
    const hasFuturePayment = linkedPayments.some(
        (payment) => payment.payment_date.getTime() > asOfMs
    );
    if (!hasFuturePayment) {
        return false;
    }

    let totalCustomerPaid = 0;
    for (const payment of linkedPayments) {
        totalCustomerPaid += toMoneyNumber(payment.customer_amount);
    }
    const remaining =
        (invoice.customer_net_amount ?? 0) - totalCustomerPaid;
    return isWithinPaidTolerance(remaining, paidTolerance);
}
