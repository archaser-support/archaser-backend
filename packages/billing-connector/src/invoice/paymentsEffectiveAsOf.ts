/**
 * Linked payments that settle as of `asOf` (`payment_date <= asOf`).
 * Future-dated rows stay linked but do not change totals or Paid until maturity.
 */
export function paymentsEffectiveAsOf<T extends { payment_date: Date }>(
    payments: T[],
    asOf: Date = new Date()
): T[] {
    const asOfMs = asOf.getTime();
    return payments.filter(
        (payment) => payment.payment_date.getTime() <= asOfMs
    );
}
