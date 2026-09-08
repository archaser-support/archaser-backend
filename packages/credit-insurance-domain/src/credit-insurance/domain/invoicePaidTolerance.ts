/**
 * Shared Paid leftover band — used by Billing Integration (status Paid) and
 * CPT / as-of open AR. Keep free of Prisma so both call sites can share it.
 *
 * Leaf package owns this so `@archaser/billing-connector` can import it without
 * a cycle (billing-connector already depends on credit-insurance-domain).
 */

export const INVOICE_PAID_TOLERANCE = 0.2;
export const INVOICE_PAID_TOLERANCE_MIN = 0;
export const INVOICE_PAID_TOLERANCE_MAX = 10;

/**
 * Paid only when customer outstanding is near zero from both sides.
 * One-sided `<= T` wrongly closes credit notes with large negative outstanding.
 */
export function isWithinPaidTolerance(
    customerOutstandingDebt: number,
    tolerance: number = INVOICE_PAID_TOLERANCE
): boolean {
    return (
        customerOutstandingDebt >= -tolerance &&
        customerOutstandingDebt <= tolerance
    );
}
