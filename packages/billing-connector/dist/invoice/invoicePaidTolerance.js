"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INVOICE_PAID_TOLERANCE_MAX = exports.INVOICE_PAID_TOLERANCE_MIN = exports.INVOICE_PAID_TOLERANCE = void 0;
exports.isWithinPaidTolerance = isWithinPaidTolerance;
exports.normalizeInvoicePaidTolerance = normalizeInvoicePaidTolerance;
exports.resolveInvoicePaidTolerance = resolveInvoicePaidTolerance;
/** Shared constant — keep free of extension registry imports to avoid cycles. */
exports.INVOICE_PAID_TOLERANCE = 0.2;
exports.INVOICE_PAID_TOLERANCE_MIN = 0;
exports.INVOICE_PAID_TOLERANCE_MAX = 10;
const INVALID_CODE = "INVALID_INVOICE_PAID_TOLERANCE";
function invalidToleranceError(message) {
    return Object.assign(new Error(message), {
        statusCode: 400,
        code: INVALID_CODE,
    });
}
/**
 * Paid only when customer outstanding is near zero from both sides.
 * One-sided `<= T` wrongly closes credit notes with large negative outstanding.
 */
function isWithinPaidTolerance(customerOutstandingDebt, tolerance = exports.INVOICE_PAID_TOLERANCE) {
    return (customerOutstandingDebt >= -tolerance &&
        customerOutstandingDebt <= tolerance);
}
/**
 * Required PUT value: finite, two decimals, 0–10. Blank/null is rejected.
 */
function normalizeInvoicePaidTolerance(input) {
    if (input === undefined || input === null) {
        throw invalidToleranceError("invoice_paid_tolerance is required");
    }
    if (typeof input === "string" && input.trim() === "") {
        throw invalidToleranceError("invoice_paid_tolerance is required");
    }
    const n = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(n)) {
        throw invalidToleranceError("invoice_paid_tolerance must be a number between 0 and 10");
    }
    const rounded = Math.round(n * 100) / 100;
    if (rounded < exports.INVOICE_PAID_TOLERANCE_MIN ||
        rounded > exports.INVOICE_PAID_TOLERANCE_MAX) {
        throw invalidToleranceError("invoice_paid_tolerance must be between 0 and 10");
    }
    return rounded;
}
/**
 * Connector-row value when the account has a BillingConnector; otherwise 0.2.
 */
async function resolveInvoicePaidTolerance(prisma, accountId) {
    if (!Number.isFinite(accountId)) {
        return exports.INVOICE_PAID_TOLERANCE;
    }
    const row = await prisma.billingConnector.findUnique({
        where: { account_id: accountId },
        select: { invoice_paid_tolerance: true },
    });
    if (!row) {
        return exports.INVOICE_PAID_TOLERANCE;
    }
    const value = Number(row.invoice_paid_tolerance);
    return Number.isFinite(value) ? value : exports.INVOICE_PAID_TOLERANCE;
}
