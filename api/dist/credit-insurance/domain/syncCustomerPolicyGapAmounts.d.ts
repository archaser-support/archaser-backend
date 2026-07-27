import { type DbClient } from "../domain-db";
export declare function syncCustomerPolicyGapAmountsForCustomer(customerId: number, options?: {
    rateDate?: Date;
    openAr?: number;
    customerPolicyRowId?: number;
    skipInvoiceFlags?: boolean;
    dbClient?: DbClient;
}): Promise<{
    missingRate: boolean;
}>;
export declare function freezeCustomerPolicyGapOnDeactivation(customerId: number, customerPolicyRowId: number, dbClient?: DbClient): Promise<void>;
export declare function syncAllCustomerPolicyGapAmounts(): Promise<{
    customersProcessed: number;
    customersUpdated: number;
    missingRates: number;
    rateDate: Date;
}>;
export declare const recomputeGapInBaseCurrencyForCustomer: typeof syncCustomerPolicyGapAmountsForCustomer;
export declare const computeGapInBaseCurrency: typeof syncAllCustomerPolicyGapAmounts;
