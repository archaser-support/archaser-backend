import { type DbClient } from "../domain-db";
/**
 * Single orchestration entry for credit-insurance capacity gap sync.
 * Order: invoice gaps → policy aggregate → in_capacity_gap flags.
 *
 * Does not re-stamp `limit_assessed_amount` — snapshots are sticky at invoice open.
 * Top-up added later does not retroactively change existing invoice gaps.
 */
export declare function syncCreditInsuranceGapPipelineForCustomer(customerId: number, options?: {
    invoiceIds?: number[];
    dbClient?: DbClient;
    skipPolicyAggregate?: boolean;
    skipFlags?: boolean;
    rateDate?: Date;
}): Promise<{
    missingRate: boolean;
}>;
/** Sync stored invoice + policy gap fields when account has credit insurance. */
export declare function ensureCustomerCapacityGapStored(customerId: number, options?: {
    invoiceIds?: number[];
    dbClient?: DbClient;
    rateDate?: Date;
}): Promise<void>;
