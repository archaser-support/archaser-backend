import { type DbClient } from "../domain-db";
/**
 * Aggregate invoice SUMs onto CustomerPolicy rows (D8).
 * `capacity_gap_amount` stores the KPI rollup (same as golden harness), not raw invoice sum.
 * `retained_capacity_gap` holds rollup state between sync runs.
 */
export declare function syncCustomerPolicyGapAmountsForCustomer(customerId: number, options?: {
    rateDate?: Date;
    openAr?: number;
    customerPolicyRowId?: number;
    skipInvoiceFlags?: boolean;
    dbClient?: DbClient;
}): Promise<{
    missingRate: boolean;
}>;
/** Freeze gap on the policy row being deactivated (call before is_active → false). */
export declare function freezeCustomerPolicyGapOnDeactivation(customerId: number, customerPolicyRowId: number, dbClient?: DbClient): Promise<void>;
export declare function syncAllCustomerPolicyGapAmounts(): Promise<{
    customersProcessed: number;
    customersUpdated: number;
    missingRates: number;
    rateDate: Date;
}>;
/** @deprecated Use {@link syncCustomerPolicyGapAmountsForCustomer}. */
export declare const recomputeGapInBaseCurrencyForCustomer: typeof syncCustomerPolicyGapAmountsForCustomer;
/** @deprecated Use {@link syncAllCustomerPolicyGapAmounts}. */
export declare const computeGapInBaseCurrency: typeof syncAllCustomerPolicyGapAmounts;
