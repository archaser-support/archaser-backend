import { type DbClient } from "../domain-db";
export type InvoiceForCapacityGapFlag = {
    id: number;
    in_capacity_gap: boolean;
    capacity_gap_amount_limit: number | {
        toNumber(): number;
    } | null;
};
export declare function computeInvoiceCapacityGapFlagsFromStored(invoices: InvoiceForCapacityGapFlag[]): Map<number, boolean>;
export declare function syncInvoiceCapacityGapFlagsForCustomer(customerId: number, options?: {
    dbClient?: DbClient;
}): Promise<void>;
export declare function syncInvoiceCapacityGapFlagsForAccount(accountId: number): Promise<{
    customersProcessed: number;
}>;
