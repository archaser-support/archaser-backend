/** Shared constant — keep free of extension registry imports to avoid cycles. */
export declare const INVOICE_PAID_TOLERANCE = 0.2;
/**
 * Paid only when customer outstanding is near zero from both sides.
 * One-sided `<= T` wrongly closes credit notes with large negative outstanding.
 */
export declare function isWithinPaidTolerance(customerOutstandingDebt: number, tolerance?: number): boolean;
