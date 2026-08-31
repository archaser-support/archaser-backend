/** Shared constant — keep free of extension registry imports to avoid cycles. */
export const INVOICE_PAID_TOLERANCE = 0.2;
export const INVOICE_PAID_TOLERANCE_MIN = 0;
export const INVOICE_PAID_TOLERANCE_MAX = 10;

const INVALID_CODE = "INVALID_INVOICE_PAID_TOLERANCE";

type BillingConnectorToleranceClient = {
    billingConnector: {
        findUnique: (args: {
            where: { account_id: number };
            select: { invoice_paid_tolerance: true };
        }) => Promise<{ invoice_paid_tolerance: number } | null>;
    };
};

function invalidToleranceError(message: string): Error {
    return Object.assign(new Error(message), {
        statusCode: 400,
        code: INVALID_CODE,
    });
}

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

/**
 * Required PUT value: finite, two decimals, 0–10. Blank/null is rejected.
 */
export function normalizeInvoicePaidTolerance(input: unknown): number {
    if (input === undefined || input === null) {
        throw invalidToleranceError("invoice_paid_tolerance is required");
    }
    if (typeof input === "string" && input.trim() === "") {
        throw invalidToleranceError("invoice_paid_tolerance is required");
    }
    const n = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(n)) {
        throw invalidToleranceError(
            "invoice_paid_tolerance must be a number between 0 and 10"
        );
    }
    const rounded = Math.round(n * 100) / 100;
    if (
        rounded < INVOICE_PAID_TOLERANCE_MIN ||
        rounded > INVOICE_PAID_TOLERANCE_MAX
    ) {
        throw invalidToleranceError(
            "invoice_paid_tolerance must be between 0 and 10"
        );
    }
    return rounded;
}

/**
 * Connector-row value when the account has a BillingConnector; otherwise 0.2.
 */
export async function resolveInvoicePaidTolerance(
    prisma: BillingConnectorToleranceClient,
    accountId: number
): Promise<number> {
    if (!Number.isFinite(accountId)) {
        return INVOICE_PAID_TOLERANCE;
    }
    const row = await prisma.billingConnector.findUnique({
        where: { account_id: accountId },
        select: { invoice_paid_tolerance: true },
    });
    if (!row) {
        return INVOICE_PAID_TOLERANCE;
    }
    const value = Number(row.invoice_paid_tolerance);
    return Number.isFinite(value) ? value : INVOICE_PAID_TOLERANCE;
}
