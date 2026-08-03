import { type DbClient } from "../domain-db";
/**
 * Persist per-invoice dual-currency capacity gap for one customer.
 * When `invoiceIds` is set, only those open invoices are recomputed; others unchanged.
 */
export declare function syncInvoiceCapacityGapAmountsForCustomer(customerId: number, options?: {
    invoiceIds?: number[];
    rateDate?: Date;
    dbClient?: DbClient;
}): Promise<{
    missingRate: boolean;
}>;
