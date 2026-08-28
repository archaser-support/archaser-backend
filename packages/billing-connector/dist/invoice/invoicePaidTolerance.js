"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVOICE_PAID_TOLERANCE = void 0;
exports.isWithinPaidTolerance = isWithinPaidTolerance;
/** Shared constant — keep free of extension registry imports to avoid cycles. */
exports.INVOICE_PAID_TOLERANCE = 0.2;
/**
 * Paid only when customer outstanding is near zero from both sides.
 * One-sided `<= T` wrongly closes credit notes with large negative outstanding.
 */
function isWithinPaidTolerance(customerOutstandingDebt, tolerance = exports.INVOICE_PAID_TOLERANCE) {
    return (customerOutstandingDebt >= -tolerance &&
        customerOutstandingDebt <= tolerance);
}
