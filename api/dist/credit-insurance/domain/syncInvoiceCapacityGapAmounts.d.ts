import { type DbClient } from "../domain-db";
export declare function syncInvoiceCapacityGapAmountsForCustomer(customerId: number, options?: {
    invoiceIds?: number[];
    rateDate?: Date;
    dbClient?: DbClient;
}): Promise<{
    missingRate: boolean;
}>;
