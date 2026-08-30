/** Shared constant — keep free of extension registry imports to avoid cycles. */
export const INVOICE_PAID_TOLERANCE = 0.2;

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
