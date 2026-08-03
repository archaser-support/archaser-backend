import { type DbClient } from "../domain-db";
export type InvoiceForCapacityGapFlag = {
    id: number;
    in_capacity_gap: boolean;
    capacity_gap_amount_limit: number | {
        toNumber(): number;
    } | null;
};
/**
 * Sticky {@link Invoice.in_capacity_gap} from stored per-invoice gap limit amount.
 */
export declare function computeInvoiceCapacityGapFlagsFromStored(invoices: InvoiceForCapacityGapFlag[]): Map<number, boolean>;
/**
 * Recompute {@link Invoice.in_capacity_gap} from stored invoice gap fields.
 * Does not invoke policy gap writer — use {@link syncCreditInsuranceGapPipelineForCustomer}.
 */
export declare function syncInvoiceCapacityGapFlagsForCustomer(customerId: number, options?: {
    dbClient?: DbClient;
}): Promise<void>;
/**
 * Batch sync for all customers on an account with credit insurance enabled.
 */
export declare function syncInvoiceCapacityGapFlagsForAccount(accountId: number): Promise<{
    customersProcessed: number;
}>;
