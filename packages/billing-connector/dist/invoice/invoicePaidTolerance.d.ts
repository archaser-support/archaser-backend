/** Shared constant — keep free of extension registry imports to avoid cycles. */
export declare const INVOICE_PAID_TOLERANCE = 0.2;
export declare const INVOICE_PAID_TOLERANCE_MIN = 0;
export declare const INVOICE_PAID_TOLERANCE_MAX = 10;
type BillingConnectorToleranceClient = {
    billingConnector: {
        findUnique: (args: {
            where: {
                account_id: number;
            };
            select: {
                invoice_paid_tolerance: true;
            };
        }) => Promise<{
            invoice_paid_tolerance: number;
        } | null>;
    };
};
/**
 * Paid only when customer outstanding is near zero from both sides.
 * One-sided `<= T` wrongly closes credit notes with large negative outstanding.
 */
export declare function isWithinPaidTolerance(customerOutstandingDebt: number, tolerance?: number): boolean;
/**
 * Required PUT value: finite, two decimals, 0–10. Blank/null is rejected.
 */
export declare function normalizeInvoicePaidTolerance(input: unknown): number;
/**
 * Connector-row value when the account has a BillingConnector; otherwise 0.2.
 */
export declare function resolveInvoicePaidTolerance(prisma: BillingConnectorToleranceClient, accountId: number): Promise<number>;
export {};
